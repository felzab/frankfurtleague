"""SCRIPTS · every Next route handler and link page is metered at the edge as its harm asks.

A route handler is a public URL from the moment the file exists, and nothing else compares the App
Router tree to the edge's locations, which `nginx/shared/site.conf` holds for both entry files: a
handler no location names reaches Next through `location /`, whose one rate zone meters server
actions alone. The accounting is total rather than aimed at the public handlers alone, because no
predicate selects those: `REASONS` carries the prefixes covering a handler, `UNMETERED` the handlers
the edge meters on no zone deliberately (`docs/ops/spec.md`).

Each rule is a row of `RULES`, which `main` runs whole. A construct this reader cannot place refuses
rather than answering, and so does a rule that found nothing to judge: either would read as a pass.

The same walk judges the intercepting pages, which no build or test below the journeys sees: Next
rewrites an intercepted URL by the page the visitor stands on, so two interceptors for one URL compete
in an order Next documents nowhere, and one under a route group intercepts from pages its group's
layout never draws.

Invariants:
- The population is `ROUTE_FILES` and the code-generated metadata conventions `METADATA` places,
  with `PAGE_FILES` joining it for a link page's meter.
- A reserved metadata name this reader cannot place refuses; an image convention supplied as an
  image file runs no module and stands outside the population.
- An intercepted URL has one intercepting page, with no route group above its intercepting segment.
- A link page's `linkpage` burst is the one the largest squad the backend publishes needs at that zone's rate.
- No location names a burst above the catch-all's on a zone the catch-all meters.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final

# Every caller runs this as a script, so sys.path opens with THIS directory and `lib/` is a
# sibling of it rather than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import (
    CONTINUATION,
    EXIT_REFUSED,
    REPO_ROOT,
    Finding,
    report_findings,
    run,
)

APP_ROUTER: Final = "fl_frontend/src/app"
NGINX_CONF: Final = "nginx/shared/site.conf"

# The whole App Router tree rather than `api/` alone: a handler filed outside that folder serves a
# URL just the same, and a walk that cannot see it accounts for nothing.

# All four extensions, because Next resolves a handler from any of them (`pageExtensions`): one
# filed as `route.tsx` answers its URL exactly as `route.ts` does.
ROUTE_FILES: Final = ("route.ts", "route.tsx", "route.js", "route.jsx")

# Derived rather than spelled again: Next reads one page-extension list for a handler and for a
# metadata convention, and two lists here would drift a metadata file out of the walk in silence.
CODE_EXTENSIONS: Final = tuple(Path(name).suffix for name in ROUTE_FILES)

# A page is charged to no location but a link page's.
PAGE_FILES: Final = tuple(f"page{suffix}" for suffix in CODE_EXTENSIONS)

# A link page's own module names `token` and its search parameters, the hook's spelling included, or
# calls the proxy's mailed-link reader, which takes the token from the cookie the proxy moved it into
# (`fl_frontend/src/core/mailedLink.ts :: mailedLinkToken`), or a module mints its link: the minter
# finds a page reading the token elsewhere, the read a page whose link nothing here mints.
LINK_TOKEN_RE: Final = re.compile(r"\btoken\b")
LINK_QUERY_RE: Final = re.compile(r"searchParams", re.IGNORECASE)
LINK_COOKIE_RE: Final = re.compile(r"\bmailedLinkToken\s*\(")

# Every minted link carries its token in the query as `?token=`, which the edge's access line leaves
# unwritten (`fl_frontend/src/core/mailedLinks.test.ts` holds every mail to it), after a template's
# origin and a page path: its module spells the path, or names the page's row in `ROUTES_MODULE`,
# read there. Any other `?token=` refuses rather than dropping a page.
TOKEN_QUERY: Final = "?token="
MINT_RE: Final = re.compile(
    r"\$\{[^{}]*\}"
    r"(?:\$\{ROUTES\.(?P<route>[A-Za-z_$][\w$]*)\.path\(\)\}"
    r"|\$\{(?P<name>[A-Za-z_$][\w$]*)(?P<key>\[[^\[\]{}]+\])?\}"
    r"|(?P<path>/[^`$?\s]*))\?token="
)

# The pages' one table, under the source tree `minted` walks (`fl_frontend/src/core/routes.ts :: ROUTES`).
ROUTES_MODULE: Final = "core/routes.ts"

# A spread, a computed key or a value that is no literal matches nothing, so a record refuses whole: a
# value skipped would drop its page.
RECORD_ENTRY_RE: Final = re.compile(r'\s*(?:[A-Za-z_$][\w$]*|"[^"]*")\s*:\s*"(?P<value>[^"]*)"\s*')

# A test file's spelling under each extension the walk reads: decided for one alone, the other's
# fixtures read as minters.
TEST_SUFFIXES: Final = tuple(f".test{suffix}" for suffix in CODE_EXTENSIONS)

# The zone `nginx/shared/http.conf` declares for the link pages, metering every request and method,
# which a link page's own location must name.
LINK_ZONES: Final = frozenset({"linkpage"})

# The link pages' own zone is sized for a season's largest squad, every pupil of it behind one school's address in one
# break, passing within `SIZING_MINUTES` at the zone's own rate (`nginx/shared/site.conf :: location /confirm/`): per
# pupil, the requests every link page's block meters on `linkpage`. The squad is the largest `max_kader_size` the
# backend publishes, read where it publishes it. The squad's sends ride the action zone at the catch-all's burst, which
# `raised_bursts` holds every block to.
OPENAPI: Final = "fl_backend/openapi.json"
SIZED_PER_PUPIL: Final = {"linkpage": 10}
SIZING_MINUTES: Final = 2

# The prefix of a `limit_req` argument naming its zone.
ZONE: Final = "zone="

# A prefix location matches on the URI string, so the catch-all covers every handler there is.
# Counting it as coverage would leave this check unable to fail.
CATCH_ALL: Final = "/"

# The character closing each segment of a dynamic handler's static head. Its own name, because a
# head ending in one has nothing to do with the catch-all above.
TRAILING_SLASH: Final = "/"

# No request URI starts with `@`, so a named location answers an internal redirect alone.
NAMED: Final = "@"

# The http-level file beside the server body, whose maps a variable `error_page` target is read through.
NGINX_HTTP_CONF: Final = "http.conf"

VARIABLE: Final = "$"


@dataclass(frozen=True)
class Reason:
    """One prefix location this accounting takes in place of a metered exact match, and why."""

    path: str
    why: str


# Every handler a prefix covers, named by that prefix rather than by itself: an allowlist of
# handlers would be a second copy of the route tree, stale the day a directory is renamed.
REASONS: Final[tuple[Reason, ...]] = (
    Reason("/api/auth", "the sign-in library's catch-all, every path of it metered by a prefix because a dynamic segment names no exact match"),
)


@dataclass(frozen=True)
class Unmetered:
    """One route handler the edge deliberately meters on no zone, and why."""

    path: str
    why: str


# By URL rather than by file, as the edge names it.
UNMETERED: Final[tuple[Unmetered, ...]] = (
    Unmetered(
        "/api/mail/delivery",
        "the mail provider's webhook: a refusal starts its retry schedule and, sustained, disables the endpoint, and its "
        "signature check is the gate",
    ),
)


@dataclass(frozen=True)
class Metadata:
    """One code-generated metadata convention, and why the URL Next serves it at is owed no meter."""

    stem: str
    url: str
    why: str


# Beside REASONS rather than in it: what covers these at the edge is the catch-all, and a reason
# naming `/` would count it as coverage -- the one direction this check may not fail in.

# The URLs mirror Next's own metadata routing rather than anything here:
# https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap, `.../robots` and
# `.../manifest`, and for the generated manifest's `.webmanifest` spelling, which those pages leave
# unsaid, Next's own `next/dist/lib/metadata/is-metadata-route.js`.
METADATA: Final[tuple[Metadata, ...]] = (
    Metadata("sitemap", "/sitemap.xml", "the route table's listed pages, rendered from the cached season list"),
    Metadata("robots", "/robots.txt", "a constant object, and the crawl entry point every other URL is reached through"),
    Metadata("manifest", "/manifest.webmanifest", "a constant object, fetched once per install"),
)

# Reserved and deliberately unplaced until a row above places one: what each answers is decided per
# file, and a generated image's sizes and ids are its exports', which this reader does not read. The
# share image is the root layout's static import, served under `/_next/static/`.
METADATA_IMAGES: Final = ("icon", "apple-icon", "opengraph-image", "twitter-image")

# A route group is dropped from the URL; a dynamic segment and a catch-all stay, because what they
# make unmeterable is exactly what this check reports.
GROUP_RE: Final = re.compile(r"^\([^()/]+\)$")
# A parallel route's slot is no segment of the URL either
# (https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes).
SLOT_RE: Final = re.compile(r"^@[A-Za-z0-9_-]+$")
# An intercepting segment on its own level answers the URL of the segment it names
# (https://nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes). One reaching a
# level up or the root, `(..)` or `(...)`, stays unread: no route of the tree has one.
SAME_LEVEL_RE: Final = re.compile(r"^\(\.\)(.+)$")
DYNAMIC_RE: Final = re.compile(r"^\[\[?(?:\.\.\.)?[A-Za-z0-9_]+\]?\]$")
# A leading underscore is outside this class deliberately: Next opts such a folder out of routing
# altogether, so a handler under one answers no URL and the derivation has nothing to answer with.
LITERAL_RE: Final = re.compile(r"^[A-Za-z0-9.~-][A-Za-z0-9._~-]*$")


class NginxSyntax(Exception):
    """A construct outside the subset this reader parses, named with the line that carries it."""


class RouteShape(Exception):
    """A segment or a reserved file name whose URL this reader cannot derive, named with its file."""


@dataclass(frozen=True)
class Directive:
    """One nginx directive: its name, its arguments, and the block under it where it opens one."""

    name: str
    args: tuple[str, ...]
    block: tuple[Directive, ...] | None
    line: int


@dataclass(frozen=True)
class Location:
    """One `location` block, at the grain this accounting reads it."""

    exact: bool
    path: str
    # The arguments of each `limit_req` line, whose zones a link page is judged by and every other
    # route by whether there is one at all.
    limits: frozenset[tuple[str, ...]]
    line: int

    @property
    def zones(self) -> frozenset[str]:
        """The zones its `limit_req` lines name."""
        return frozenset(arg.removeprefix(ZONE) for args in self.limits for arg in args if arg.startswith(ZONE))

    @property
    def metered(self) -> bool:
        """Whether any `limit_req` line meters this block."""
        return bool(self.zones)

    def matches(self, uri: str) -> bool:
        """Whether this block answers `uri`, by nginx's own string comparison rather than by segment."""
        return self.path == uri if self.exact else uri.startswith(self.path)


@dataclass(frozen=True)
class Handler:
    """One routable file, the URL it answers, and the part of that URL an exact match could name."""

    path: Path
    url: str
    # Everything before the first dynamic segment. Equal to `url` where there is none, and what a
    # prefix location has to cover for the whole handler to be covered.
    head: str
    dynamic: bool


def lex(text: str, source: str) -> list[tuple[str, str, int]]:
    """The configuration as `(kind, value, line)` tokens: a word, or one of `{`, `}` and `;`."""
    tokens: list[tuple[str, str, int]] = []
    line = 1
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\n":
            line += 1
            index += 1
        elif char in " \t\r":
            index += 1
        elif char == "#":
            while index < len(text) and text[index] != "\n":
                index += 1
        elif char in "{};":
            tokens.append((char, char, line))
            index += 1
        elif char in "\"'":
            value, index, line = _quoted(text, index, line, source)
            tokens.append(("word", value, line))
        else:
            start = index
            while index < len(text) and text[index] not in " \t\r\n{};#":
                index += 1
            tokens.append(("word", text[start:index], line))
    return tokens


def _quoted(text: str, index: int, line: int, source: str) -> tuple[str, int, int]:
    """One quoted string, answering its content and where the scan resumes.

    A `log_format` string spans lines, so the line counter travels with the scan rather than being
    recovered afterwards.
    """
    quote = text[index]
    opened = line
    index += 1
    out: list[str] = []
    while index < len(text) and text[index] != quote:
        # The escape is consumed whole, or a `\"` inside a regex would close the string here.
        if text[index] == "\\" and index + 1 < len(text):
            out.append(text[index])
            index += 1
        if text[index] == "\n":
            line += 1
        out.append(text[index])
        index += 1
    if index >= len(text):
        raise NginxSyntax(f"{source}:{opened}: a quoted string that never closes")
    # The advanced counter, not `opened`: every line the string spanned is a line the scan passed,
    # and handing back the opening one makes each refusal below it name a line too low.
    return "".join(out), index + 1, line


def parse(text: str, source: str) -> tuple[Directive, ...]:
    """The configuration as a tree of directives."""
    tree, _ = _block(lex(text, source), 0, source, top=True)
    return tree


def _block(tokens: list[tuple[str, str, int]], index: int, source: str, *, top: bool) -> tuple[tuple[Directive, ...], int]:
    """The directives from `index` to the closing brace, and the index of the token after it."""
    out: list[Directive] = []
    words: list[str] = []
    opened = 0
    while index < len(tokens):
        kind, value, line = tokens[index]
        if kind == "word":
            if not words:
                opened = line
            words.append(value)
            index += 1
        elif kind == ";":
            if not words:
                raise NginxSyntax(f"{source}:{line}: a semicolon with no directive in front of it")
            out.append(Directive(words[0], tuple(words[1:]), None, opened))
            words = []
            index += 1
        elif kind == "{":
            if not words:
                raise NginxSyntax(f"{source}:{line}: a block with no directive naming it")
            nested, index = _block(tokens, index + 1, source, top=False)
            out.append(Directive(words[0], tuple(words[1:]), nested, opened))
            words = []
        else:
            if top:
                raise NginxSyntax(f"{source}:{line}: a block closes without opening")
            if words:
                raise NginxSyntax(f"{source}:{opened}: a directive that never ends in a semicolon")
            return tuple(out), index + 1
    if not top:
        raise NginxSyntax(f"{source}: a block that never closes")
    if words:
        raise NginxSyntax(f"{source}:{opened}: a directive that never ends in a semicolon")
    return tuple(out), index


def read_location(directive: Directive, source: str, redirected: frozenset[str] = frozenset()) -> Location | None:
    """One `location` block as this accounting reads it, refusing a modifier it cannot judge.

    `None` for a named location an `error_page` of the same level sends to, which answers no
    request URI and so covers no handler.
    """
    block = directive.block
    if block is None:
        raise NginxSyntax(f"{source}:{directive.line}: a location with no block under it")
    if any(child.name == "location" for child in block):
        raise NginxSyntax(f"{source}:{directive.line}: a location nested inside a location, whose match order this reader does not resolve")
    limits = frozenset(child.args for child in block if child.name == "limit_req")
    # Refused rather than read as a prefix: `@fallback` would cover every handler whose URL starts
    # with it, which is none of them, and reading it as coverage is the one direction this check
    # may not fail in.
    path = directive.args[-1] if directive.args else ""
    if len(directive.args) == 1 and path.startswith(NAMED):
        if path in redirected:
            return None
        raise NginxSyntax(f"{source}:{directive.line}: the named location {path!r}, which no request URI and no error_page reaches")
    # Answered at the edge rather than forwarded: no route behind it is reached, so this accounting has nothing to read.
    if any(child.name == "return" for child in block):
        raise NginxSyntax(f"{source}:{directive.line}: a location answering with `return`, which forwards no route this reader can account for")
    if len(directive.args) == 1:
        return Location(False, path, limits, directive.line)
    if len(directive.args) == 2:
        modifier, path = directive.args
        if modifier == "=":
            return Location(True, path, limits, directive.line)
        # `^~` still matches a prefix; a regex matches on something this reader cannot compare a
        # directory tree against, so it refuses rather than calling the handler uncovered.
        if modifier == "^~":
            return Location(False, path, limits, directive.line)
        raise NginxSyntax(f"{source}:{directive.line}: the location modifier {modifier!r}, which selects by something other than a path prefix")
    raise NginxSyntax(f"{source}:{directive.line}: a location taking {len(directive.args)} argument(s)")


def map_values(tree: tuple[Directive, ...]) -> dict[str, frozenset[str]]:
    """Each `map`'s variable beside every value it can take, its default among them.

    An `error_page` naming a variable sends to whichever value the map gives it, so each is a target.
    """
    return {
        directive.args[-1]: frozenset(entry.args[-1] for entry in directive.block if entry.args)
        for directive in tree
        if directive.name == "map" and directive.block is not None and directive.args
    }


def locations(tree: tuple[Directive, ...], source: str, maps: Mapping[str, frozenset[str]] | None = None) -> tuple[Location, ...]:
    """Every `location` of the one level that declares any.

    That level is a server body: the top of `nginx/shared/site.conf`, which each entry file includes
    inside its own `server`, or one server block of a file carrying its own.
    """
    serving = [
        directive
        for directive in tree
        if directive.name == "server" and directive.block is not None and any(child.name == "location" for child in directive.block)
    ]
    top = any(directive.name == "location" for directive in tree)
    if top and serving:
        raise NginxSyntax(f"{source}: locations both at the top and inside a server block, and this reader cannot say which answers")
    if not top and len(serving) != 1:
        raise NginxSyntax(
            f"{source}: {len(serving)} server blocks declare a location, and this reader cannot say which one answers a route handler"
        )
    block = tree if top else (serving[0].block or ())
    # The redirect's target is an `error_page`'s last argument; a location declaring one of its own
    # is nested, which `read_location` refuses before this could matter.
    redirected = frozenset(
        target
        for child in block
        if child.name == "error_page" and child.args
        for target in _targets(child.args[-1], maps or {}, source, child.line)
    )
    read = (read_location(child, source, redirected) for child in block if child.name == "location")
    found = tuple(location for location in read if location is not None)
    named = {child.args[0] for child in block if child.name == "location" and len(child.args) == 1}
    dangling = sorted(target for target in redirected if target.startswith(NAMED) and target not in named)
    if dangling:
        raise NginxSyntax(f"{source}: an error_page sends to {dangling[0]!r}, which no named location declares")
    _declared_once(found, source)
    return found


def edge_locations(conf_path: Path) -> tuple[Location, ...]:
    """The server body's locations, its variable `error_page` targets read through the http level beside it.

    Bytes, so no platform's newline translation reaches a path this reader then compares.
    """
    http_path = conf_path.parent / NGINX_HTTP_CONF
    maps = map_values(parse(http_path.read_bytes().decode("utf-8"), http_path.name))
    return locations(parse(conf_path.read_bytes().decode("utf-8"), conf_path.name), conf_path.name, maps)


def _targets(target: str, maps: Mapping[str, frozenset[str]], source: str, line: int) -> frozenset[str]:
    """Where one `error_page` sends: its target, or every value of the map a variable target names."""
    if not target.startswith(VARIABLE):
        return frozenset({target})
    if target not in maps:
        # Refused rather than read as reaching nothing: every named location would then read as dead.
        raise NginxSyntax(f"{source}:{line}: an error_page sends to {target}, which no map at the http level defines")
    return maps[target]


def _declared_once(found: tuple[Location, ...], source: str) -> None:
    """Refuse a path two exact matches declare, which nginx refuses outright and this reader keys on.

    The meter is what a second one costs: an unmetered block first leaves the handler behind it
    reading as metered.
    """
    first: dict[str, int] = {}
    for one in found:
        if not one.exact:
            continue
        if one.path in first:
            raise NginxSyntax(f"{source}:{one.line}: the exact match {one.path!r} is declared again, first at {source}:{first[one.path]}")
        first[one.path] = one.line


def url_of(parts: tuple[str, ...], route: Path) -> tuple[str, str, bool]:
    """The URL a route file answers, the part of it before any dynamic segment, and whether one is there."""
    segments: list[str] = []
    head: list[str] = []
    dynamic = False
    for part in parts:
        if GROUP_RE.match(part) or SLOT_RE.match(part):
            continue
        intercepted = SAME_LEVEL_RE.match(part)
        if intercepted:
            part = intercepted.group(1)
        if DYNAMIC_RE.match(part):
            dynamic = True
        elif not LITERAL_RE.match(part):
            raise RouteShape(f"{route}: the directory segment {part!r}, whose place in a URL this reader cannot derive")
        segments.append(part)
        if not dynamic:
            head.append(part)
    url = "/" + "/".join(segments)
    # Each segment closed by its own slash, so a handler whose first segment is dynamic answers
    # with the root rather than with `//`, which starts under no prefix location at all.
    static = "/" + "".join(f"{part}{TRAILING_SLASH}" for part in head) if dynamic else url
    return url, static, dynamic


def handlers(app_dir: Path) -> tuple[Handler, ...]:
    """Every route handler under the App Router tree, in path order."""
    if not app_dir.is_dir():
        raise RouteShape(f"{app_dir}: no App Router tree here, so no handler was accounted for")
    found: list[Handler] = []
    # `route.*` rather than each name in turn: a literal pattern is answered from the pattern, and
    # a case-blind filesystem hands back `route.ts` for a `Route.ts` Next does not resolve at all.
    for route in sorted(one for one in app_dir.rglob("route.*") if one.name in ROUTE_FILES):
        url, head, dynamic = url_of(route.parent.relative_to(app_dir).parts, route)
        found.append(Handler(route, url, head, dynamic))
    return tuple(found)


def pages(app_dir: Path) -> tuple[Handler, ...]:
    """Every page under the App Router tree, in path order."""
    found: list[Handler] = []
    for page in sorted(one for one in app_dir.rglob("page.*") if one.name in PAGE_FILES):
        url, head, dynamic = url_of(page.parent.relative_to(app_dir).parts, page)
        found.append(Handler(page, url, head, dynamic))
    return tuple(found)


def _address(url: str) -> str:
    """A URL with each dynamic segment reduced to its kind, so `[saison]` and `[id]` read as one address."""
    return "/".join(
        ("[[...]]" if part.startswith("[[") else "[...]" if part.startswith("[...") else "[]") if DYNAMIC_RE.match(part) else part
        for part in url.split("/")
    )


class NothingJudged(Exception):
    """A rule that found nothing to judge, which would otherwise read as a pass."""


@dataclass(frozen=True)
class Accounting:
    """What every rule reads: the tree's handlers and pages, its link pages, and the edge's locations and zones."""

    found: tuple[Handler, ...]
    paged: tuple[Handler, ...]
    linked: tuple[Handler, ...]
    where: tuple[Location, ...]
    rates: Mapping[str, int]
    squad: int
    app_dir: Path
    root: Path
    conf: str


def interceptions(judged: Accounting) -> list[Finding]:
    """Every intercepting page sharing its URL with another, or standing under a route group.

    Next keys an interceptor's rewrite on the page the visitor leaves, read from the interceptor's level, and a route
    group is no level: a slot of `(classic)` intercepting `(.)saisons` reaches from `/`, so from every page of the site,
    where the group's layout draws the slot on its own pages alone. Two rewrites for one URL both match from a page
    under both levels, and the first in the build's order wins.
    """
    findings: list[Finding] = []
    by_address: dict[str, list[Handler]] = {}
    for page in judged.paged:
        parts = page.path.parent.relative_to(judged.app_dir).parts
        at = next((index for index, part in enumerate(parts) if SAME_LEVEL_RE.match(part)), None)
        if at is None:
            continue
        by_address.setdefault(_address(page.url), []).append(page)
        grouped = [part for part in parts[:at] if GROUP_RE.match(part)]
        if grouped:
            findings.append(
                Finding(
                    "fail",
                    f"{shown(page.path, judged.root)} intercepts {page.url} under the route group {grouped[0]}\n"
                    f"{CONTINUATION}a group is no level of the URL, so the interceptor reaches from every page of its "
                    f"parent level while the group's layout draws the slot on its own pages alone: "
                    f"put the slot in the layout every page it intercepts from shares",
                )
            )
    for address, pages_there in sorted(by_address.items()):
        if len(pages_there) > 1:
            findings.append(
                Finding(
                    "fail",
                    f"{', '.join(shown(one.path, judged.root) for one in pages_there)} all intercept {address}\n"
                    f"{CONTINUATION}from a page both levels hold, their rewrites compete in an order Next documents nowhere: "
                    f"keep one interceptor for the address, in the slot every page it intercepts from shares",
                )
            )
    return findings


def link_pages(found: tuple[Handler, ...]) -> tuple[Handler, ...]:
    """Every page reading a mailed link's token from its search parameters or through the proxy's mailed-link reader."""
    linked: list[Handler] = []
    for page in found:
        # Bytes, as the configuration is read, so no platform's decoding default decides the match.
        text = page.path.read_bytes().decode("utf-8")
        if (LINK_TOKEN_RE.search(text) and LINK_QUERY_RE.search(text)) or LINK_COOKIE_RE.search(text):
            linked.append(page)
    return tuple(linked)


def minted(source: Path) -> tuple[tuple[Path, str], ...]:
    """Every link a module under `source` mints, as that module and the path its `?token=` follows."""
    found: list[tuple[Path, str]] = []
    modules = (one for one in source.rglob("*") if one.suffix in CODE_EXTENSIONS and not one.name.endswith(TEST_SUFFIXES) and one.is_file())
    for module in sorted(modules):
        text = module.read_bytes().decode("utf-8")
        hits = list(MINT_RE.finditer(text))
        if len(hits) != text.count(TOKEN_QUERY):
            raise RouteShape(f"{module}: a `{TOKEN_QUERY}` behind no origin and page path this reader can place")
        for hit in hits:
            found += ((module, path) for path in _link_paths(hit, text, module, source))
    return tuple(found)


def _route_path(key: str, source: Path, module: Path) -> str:
    """The fixed path `ROUTES.<key>` answers, read off its row: a row taking segments names no one page a mail opens."""
    table = source / ROUTES_MODULE
    text = table.read_bytes().decode("utf-8") if table.is_file() else ""
    row = re.search(rf"^\s*{re.escape(key)}:\s*\{{\s*path:\s*\(\)\s*=>\s*\"(?P<path>/[^\"]*)\"\s+as\s+const\b", text, re.MULTILINE)
    if row is None:
        raise RouteShape(f"{module}: the link path ROUTES.{key}, which no row of {table} answers with one fixed path")
    return row["path"]


def _link_paths(hit: re.Match[str], text: str, module: Path, source: Path) -> tuple[str, ...]:
    """The page path, or every path a record may hand it, one `MINT_RE` hit places."""
    if hit["route"] is not None:
        return (_route_path(hit["route"], source, module),)
    if hit["path"] is not None:
        return (hit["path"],)
    name = re.escape(hit["name"])
    if hit["key"] is None:
        declared = re.search(rf"\bconst\s+{name}\s*(?::[^=]*)?=\s*\"([^\"]*)\"", text)
        if declared is None:
            raise RouteShape(f"{module}: the link path {hit['name']}, which no string constant of this module declares")
        return (declared[1],)
    record = re.search(rf"\bconst\s+{name}\s*(?::[^=]*)?=\s*\{{(?P<body>[^{{}}]*)\}}", text)
    # A trailing comma leaves one blank part, and nothing else may be blank.
    parts = [] if record is None else record["body"].split(",")
    if parts and parts[-1].strip() == "":
        parts.pop()
    entries = [RECORD_ENTRY_RE.fullmatch(part) for part in parts]
    if not entries or None in entries:
        raise RouteShape(f"{module}: the link path {hit['name']}{hit['key']}, which no record of string literals in this module declares")
    return tuple(entry["value"] for entry in entries if entry is not None)


def linked_pages(paged: tuple[Handler, ...], mints: tuple[tuple[Path, str], ...]) -> tuple[Handler, ...]:
    """Every page a minted link opens or that reads a link's token itself, in path order.

    A minted link no page answers opens Next's not-found page, which `fl_frontend/src/core/mailedLinks.test.ts` holds
    every mail to; here it opens no page to meter.
    """
    answering = {page.url: page for page in paged if not page.dynamic}
    opened = {answering[path] for _, path in mints if path in answering}
    return tuple(sorted(opened | set(link_pages(paged)), key=lambda one: one.path))


def kader_size_max(openapi_path: Path) -> int:
    """The largest `max_kader_size` a season may set, as `fl_backend/openapi.json` publishes it."""
    document = json.loads(openapi_path.read_bytes().decode("utf-8"))
    return int(document["components"]["schemas"]["FLSaisonRules"]["properties"]["max_kader_size"]["maximum"])


def zone_rates(http_path: Path) -> dict[str, int]:
    """Each `limit_req_zone` the http level declares, by name, at its rate in requests a minute."""
    rates: dict[str, int] = {}
    for directive in parse(http_path.read_bytes().decode("utf-8"), http_path.name):
        if directive.name != "limit_req_zone":
            continue
        named = next((arg.removeprefix(ZONE).partition(":")[0] for arg in directive.args if arg.startswith(ZONE)), None)
        rate = next((arg.removeprefix("rate=") for arg in directive.args if arg.startswith("rate=")), None)
        if named is None or rate is None or not rate.endswith("r/m") or not rate.removesuffix("r/m").isdigit():
            raise NginxSyntax(f"{http_path.name}:{directive.line}: a limit_req_zone this reader cannot read a per-minute rate from")
        rates[named] = int(rate.removesuffix("r/m"))
    return rates


def raised_bursts(judged: Accounting) -> list[Finding]:
    """Every block naming a zone the catch-all meters on a burst above the catch-all's.

    The catch-all's zone meters server actions alone, and Next runs an action by its `Next-Action` header at whatever
    path it is posted to, so a block raising that burst raises every action's ceiling for a network. A burst nginx
    cannot read refuses the configuration at load, so it is judged nowhere here.
    """
    catch_all = next((one for one in judged.where if not one.exact and one.path == CATCH_ALL), None)
    ceilings = {} if catch_all is None else {zone: burst for zone, burst in map(zone_and_burst, catch_all.limits) if zone is not None}
    if not ceilings:
        raise NothingJudged(f"{judged.conf}: `location /` meters no zone, so no block's burst has a ceiling to be judged against")
    findings: list[Finding] = []
    for one in judged.where:
        for args in sorted(one.limits):
            zone, burst = zone_and_burst(args)
            if zone not in ceilings or burst <= ceilings[zone]:
                continue
            findings.append(
                Finding(
                    "fail",
                    f"{judged.conf}:{one.line}: `location {'= ' if one.exact else ''}{one.path}` meters {zone} with "
                    f"`limit_req {' '.join(args)}`, above `location /`'s burst={ceilings[zone]}\n"
                    f"{CONTINUATION}a server action runs at any path, so this raises every action's ceiling: declare `location /`'s burst",
                )
            )
    return findings


def zone_and_burst(args: tuple[str, ...]) -> tuple[str | None, int]:
    """The zone one `limit_req` line names and its burst, nginx's default of none where it names none."""
    zone = next((arg.removeprefix(ZONE) for arg in args if arg.startswith(ZONE)), None)
    burst = next((arg.removeprefix("burst=") for arg in args if arg.startswith("burst=")), "0")
    return zone, int(burst) if burst.isdigit() else 0


def unsized_links(judged: Accounting) -> list[Finding]:
    """Every link page's burst on a sized zone that is not the one the squad's pupils need at that zone's rate."""
    undeclared = sorted(zone for zone in SIZED_PER_PUPIL if zone not in judged.rates)
    if undeclared:
        raise NothingJudged(f"{NGINX_HTTP_CONF} declares no {undeclared[0]} zone, so no link page's burst could be sized against its rate")
    expected = {zone: per_pupil * judged.squad - SIZING_MINUTES * judged.rates[zone] for zone, per_pupil in SIZED_PER_PUPIL.items()}
    findings: list[Finding] = []
    for one in judged.where:
        if not LINK_ZONES <= one.zones:
            continue
        for args in sorted(one.limits):
            zone, burst = zone_and_burst(args)
            if zone not in expected or burst == expected[zone]:
                continue
            findings.append(
                Finding(
                    "fail",
                    f"{judged.conf}:{one.line}: `location {'= ' if one.exact else ''}{one.path}` meters {zone} with "
                    f"`limit_req {' '.join(args)}`, where a squad of {judged.squad} needs burst={expected[zone]}\n"
                    f"{CONTINUATION}the link pages are sized for the largest squad {OPENAPI} publishes: size the burst for it",
                )
            )
    return findings


def answering_location(uri: str, where: tuple[Location, ...]) -> Location | None:
    """The location nginx chooses for `uri`: its exact match, else its longest prefix, the catch-all included."""
    for one in where:
        if one.exact and one.path == uri:
            return one
    candidates = [one for one in where if not one.exact and uri.startswith(one.path)]
    return max(candidates, key=lambda one: len(one.path)) if candidates else None


def unmetered_links(judged: Accounting) -> list[Finding]:
    """Every link page whose URL reaches a location not naming `LINK_ZONES`."""
    if not judged.linked:
        raise NothingJudged(f"no page under {APP_ROUTER} reads a mailed link's token or is opened by a minted link, so none was judged")
    findings: list[Finding] = []
    for page in judged.linked:
        location = answering_location(page.url, judged.where)
        if location is not None and LINK_ZONES <= location.zones:
            continue
        reached = "no location" if location is None else f"`location {'= ' if location.exact else ''}{location.path}`"
        findings.append(
            Finding(
                "fail",
                f"{shown(page.path, judged.root)} reads a link's token, and {page.url} reaches {reached} in {judged.conf}, "
                f"which does not meter it on {', '.join(sorted(LINK_ZONES))}\n"
                f"{CONTINUATION}put the page under a prefix carrying that zone, or give it an exact match carrying it",
            )
        )
    return findings


def metadata(app_dir: Path) -> tuple[Metadata, ...]:
    """Every code-generated metadata convention under the tree, in path order."""
    placed = {one.stem: one for one in METADATA}
    served: list[Metadata] = []
    for path in sorted(one for one in app_dir.rglob("*") if one.suffix in CODE_EXTENSIONS and one.is_file()):
        # A private folder is out of routing (`LITERAL_RE`), and `_components/icon.tsx` is an
        # ordinary component: refusing it would be repaired by renaming the component.
        if any(part.startswith("_") for part in path.relative_to(app_dir).parts[:-1]):
            continue
        # The whole stem, so `sitemap.test.ts` beside `sitemap.ts` is the neighbour it is rather
        # than a second claim on the same URL.
        stem = path.stem
        if stem in METADATA_IMAGES:
            raise RouteShape(f"{path}: the metadata image {path.name!r}, whose URLs its own exports decide")
        row = placed.get(stem)
        if row is None:
            continue
        if path.parent != app_dir:
            raise RouteShape(
                f"{path}: the metadata convention {path.name!r} outside the App Router root, where Next resolves robots and manifest "
                "not at all, a sitemap at a URL its own exports decide and an image under its segment's own address"
            )
        served.append(row)
    return tuple(served)


def covering_prefix(head: str, found: tuple[Location, ...]) -> Location | None:
    """The prefix location nginx would choose for `head`, the catch-all never counting as one."""
    candidates = [one for one in found if not one.exact and one.path != CATCH_ALL and head.startswith(one.path)]
    return max(candidates, key=lambda one: len(one.path)) if candidates else None


def declaring(path: str) -> Reason | None:
    """The recorded reason for a prefix location, or None where none is written."""
    for reason in REASONS:
        if reason.path == path:
            return reason
    return None


def shown(path: Path, root: Path) -> str:
    """A path as a finding writes it."""
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def account(judged: Accounting) -> list[Finding]:
    """Every handler judged against the locations: an exact match carrying a zone, a recorded prefix, or recorded unmetered."""
    # One entry per path, `locations` having refused a second exact match on one.
    exact = {one.path: one for one in judged.where if one.exact}
    exempt = {one.path for one in UNMETERED}
    findings: list[Finding] = []
    for handler in judged.found:
        if handler.url in exempt:
            continue
        name = shown(handler.path, judged.root)
        match = None if handler.dynamic else exact.get(handler.url)
        if match is not None:
            if not match.metered:
                findings.append(
                    Finding(
                        "fail",
                        f"{name} answers {handler.url}, whose exact-match location carries no limit_req\n"
                        f"{CONTINUATION}an exact match is where a rate is declared, and {judged.conf} declares none there",
                    )
                )
            continue
        prefix = covering_prefix(handler.head, judged.where)
        if prefix is None:
            findings.append(_unreached(handler, name, judged.conf))
        elif declaring(prefix.path) is None:
            findings.append(
                Finding(
                    "fail",
                    f"{name} answers {handler.url}, covered by the prefix location {prefix.path} and by no recorded reason\n"
                    f"{CONTINUATION}meter it with an exact-match location, or record why that prefix is enough at "
                    f"scripts/checks/check_public_routes.py :: REASONS",
                )
            )
    return findings


def _unreached(handler: Handler, name: str, conf: str) -> Finding:
    """The finding for a handler no location but the catch-all reaches."""
    if handler.dynamic:
        return Finding(
            "fail",
            f"{name} answers {handler.url}, which no exact match can name and no prefix location covers\n"
            f"{CONTINUATION}a dynamic segment is unmeterable without a prefix: give {conf} one, or the whole subtree runs unmetered",
        )
    return Finding(
        "fail",
        f"{name} answers {handler.url}, and no location in {conf} names it\n"
        f"{CONTINUATION}it reaches Next through `location /`, whose one rate zone meters server actions alone",
    )


# Every rule `main` runs, each over the whole accounting: a rule written and left out of this table is
# one nothing runs, which the table makes a reader's to see rather than a sequence of calls to miss.
RULES: Final = (account, unmetered_links, unsized_links, raised_bursts, interceptions)


def main() -> int:
    parser = argparse.ArgumentParser(description="Is every Next route handler accounted for by an nginx location?")
    parser.add_argument(
        "paths", nargs="*", metavar="PATH", help=f"the App Router tree and the edge configuration (default: {APP_ROUTER} {NGINX_CONF})"
    )
    args = parser.parse_args()

    if len(args.paths) not in (0, 2):
        parser.error("give both paths or neither")
    names: list[str] = args.paths or [str(REPO_ROOT / APP_ROUTER), str(REPO_ROOT / NGINX_CONF)]
    app_dir, conf_path = Path(names[0]), Path(names[1])
    root = REPO_ROOT if not args.paths else app_dir.parent

    try:
        found = handlers(app_dir)
        paged = pages(app_dir)
        # The source tree the App Router tree sits in, `fl_frontend/src`, holds every module minting a link.
        mints = minted(app_dir.parent)
        served = metadata(app_dir)
        where = edge_locations(conf_path)
        rates = zone_rates(conf_path.parent / NGINX_HTTP_CONF)
        linked = linked_pages(paged, mints)
    except (NginxSyntax, RouteShape) as error:
        print(f"      {error}", file=sys.stderr)
        print("      Nothing was accounted for, so this is a refusal rather than a verdict on the routes.", file=sys.stderr)
        print("      Teach scripts/checks/check_public_routes.py the construct, or revert it.", file=sys.stderr)
        return EXIT_REFUSED
    except (OSError, UnicodeDecodeError) as error:
        print(f"      {error}", file=sys.stderr)
        print("      Nothing was accounted for: the route tree and the edge configuration both have to be readable.", file=sys.stderr)
        # Input the checker cannot judge, which the kernel's contract calls EXIT_REFUSED.
        # EXIT_CRASH would claim the environment is broken and send a reader to the wrong repair.
        return EXIT_REFUSED
    # Apart from the reads above, so a programming error in them crashes as one rather than reading as an unreadable
    # tree: here a `ValueError`, `KeyError` or `TypeError` can only be the published document's shape.
    try:
        squad = kader_size_max(REPO_ROOT / OPENAPI)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"      {error}", file=sys.stderr)
        print(f"      Nothing was accounted for: {OPENAPI}'s squad bound has to be readable.", file=sys.stderr)
        return EXIT_REFUSED

    judged = Accounting(found, paged, linked, where, rates, squad, app_dir, root, conf_path.name)
    try:
        findings = [finding for rule in RULES for finding in rule(judged)]
    except NothingJudged as error:
        print(f"      {error}", file=sys.stderr)
        print("      A rule found nothing to judge, so this is a refusal rather than a pass.", file=sys.stderr)
        return EXIT_REFUSED

    code = report_findings(findings)
    if findings:
        print("\n      A route handler is a public URL, so the accounting is total: every one is either an")
        print("      exact-match location carrying limit_req, a prefix location with a recorded reason, or")
        print("      recorded at check_public_routes.py :: UNMETERED, and a metadata convention is taken")
        print("      unmetered where :: METADATA says why. A page a link opens sits where :: LINK_ZONES meters")
        print("      it, its burst sized for the largest squad :: OPENAPI publishes. No location names a burst")
        print("      above location /'s on a zone it meters, every action's ceiling. The rule is docs/ops/spec.md,")
        print("      section 1.3. An intercepted URL has one intercepting page, under no route group:")
        print("      :: interceptions says why.")
        return code

    metered = sum(1 for one in where if one.exact and one.metered)
    print(
        f"      {len(found)} route handler(s) accounted for, {len(served)} metadata convention(s) taken unmetered, "
        f"{metered} metered exact-match location(s), {len(REASONS)} recorded reason(s), "
        f"{len(linked)} link page(s) on the link pages' zone"
    )
    return code


if __name__ == "__main__":
    sys.exit(run(main))
