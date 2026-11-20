"""Every Next route handler is metered at the edge as its harm asks.

A route handler is a public URL from the moment the file exists, and nothing else compares the App
Router tree to the edge's locations, which the shared site body holds for both entry files: a
handler no location names reaches Next through `location /`, whose one rate zone meters server
actions alone. The accounting is total rather than aimed at the public handlers alone, because no
predicate selects those: `REASONS` carries the prefixes covering a handler, `UNMETERED` the handlers
the edge meters on no zone deliberately. The pages a mailed link opens are the edge test's, which
serves them (`scripts/checks/edge_test.sh`).

Each rule is a row of `RULES`, which `main` runs whole. A construct this reader cannot place refuses
rather than answering, which would read as a pass.

Invariants:
- The population is `ROUTE_FILES` and the code-generated metadata conventions `METADATA` places.
- A reserved metadata name this reader cannot place refuses; an image convention supplied as an
  image file runs no module and stands outside the population.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final

# Run by hand, a script's sys.path opens with its own directory, and `lib/` is a sibling of it rather
# than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import (
    CONTINUATION,
    EXIT_REFUSED,
    REPO_ROOT,
    Finding,
    report_findings,
    run,
)
from nginx_conf import Directive, NginxSyntax, read

APP_ROUTER: Final = "fl_frontend/src/app"
NGINX_CONF: Final = "nginx/shared/site.conf"

# The whole App Router tree rather than `api/` alone: a handler filed outside that folder serves a
# URL just the same, and a walk that cannot see it accounts for nothing.

# Both extensions the frontend's `pageExtensions` gives Next: one filed as `route.tsx` answers its
# URL exactly as `route.ts` does.
ROUTE_FILES: Final = ("route.ts", "route.tsx")

# Derived rather than spelled again: Next reads one page-extension list for a handler and for a
# metadata convention, and two lists here would drift a metadata file out of the walk in silence.
CODE_EXTENSIONS: Final = tuple(Path(name).suffix for name in ROUTE_FILES)

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
    *(
        Unmetered(
            path,
            "a GET answering with one redirect to the page in the season the site is on, off the cached season list every "
            "visitor shares, as cheap as the page GETs `location /` leaves unmetered",
        )
        for path in ("/saisons", "/saisons/ko-runde", "/saisons/tabelle", "/saisons/teams", "/saisons/search")
    ),
    Unmetered(
        "/area",
        "a signed-in person's landing, a GET answering with one redirect off the session read and the backend lookup "
        "every page under it makes, as cheap as the page GETs `location /` leaves unmetered; on the sign-in's zone it "
        "would spend that budget twice on every sign-in",
    ),
)


@dataclass(frozen=True)
class Metadata:
    """One code-generated metadata convention, by its file's stem, and why the URL Next serves it at is owed no meter."""

    stem: str
    why: str


# Beside REASONS rather than in it: what covers these at the edge is the catch-all, and a reason
# naming `/` would count it as coverage -- the one direction this check may not fail in.
METADATA: Final[tuple[Metadata, ...]] = (
    Metadata("sitemap", "the route table's listed pages, rendered from the cached season list"),
    Metadata("robots", "a constant object, and the crawl entry point every other URL is reached through"),
    Metadata("manifest", "a constant object, fetched once per install"),
)

# Reserved and deliberately unplaced until a row above places one: what each answers is decided per
# file, and a generated image's sizes and ids are its exports', which this reader does not read. The
# share image is the root layout's static import, served under `/_next/static/`.
METADATA_IMAGES: Final = ("icon", "apple-icon", "opengraph-image", "twitter-image")

# A route group is dropped from the URL; a dynamic segment and a catch-all stay, because what they
# make unmeterable is exactly what this check reports.
GROUP_RE: Final = re.compile(r"^\([^()/]+\)$")
# A parallel route's slot is no segment of the URL either.
SLOT_RE: Final = re.compile(r"^@[A-Za-z0-9_-]+$")
# An intercepting segment on its own level answers the URL of the segment it names. One reaching a
# level up or the root, `(..)` or `(...)`, stays unread: no route of the tree has one.
SAME_LEVEL_RE: Final = re.compile(r"^\(\.\)(.+)$")
DYNAMIC_RE: Final = re.compile(r"^\[\[?(?:\.\.\.)?[A-Za-z0-9_]+\]?\]$")
# A leading underscore is outside this class deliberately: Next opts such a folder out of routing
# altogether, so a handler under one answers no URL and the derivation has nothing to answer with.
LITERAL_RE: Final = re.compile(r"^[A-Za-z0-9.~-][A-Za-z0-9._~-]*$")


class RouteShape(Exception):
    """A segment or a reserved file name whose URL this reader cannot derive, named with its file."""


@dataclass(frozen=True)
class Location:
    """One `location` block, at the grain this accounting reads it."""

    exact: bool
    path: str
    # The arguments of each `limit_req` line, a route judged by whether there is one at all.
    limits: frozenset[tuple[str, ...]]
    line: int

    @property
    def metered(self) -> bool:
        """Whether any `limit_req` line meters this block."""
        return any(arg.startswith(ZONE) for args in self.limits for arg in args)


@dataclass(frozen=True)
class Handler:
    """One routable file, the URL it answers, and the part of that URL an exact match could name."""

    path: Path
    url: str
    # Everything before the first dynamic segment. Equal to `url` where there is none, and what a
    # prefix location has to cover for the whole handler to be covered.
    head: str
    dynamic: bool


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

    That level is a server body: the top of the shared site body, which each entry file includes
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
    maps = map_values(read(http_path))
    return locations(read(conf_path), conf_path.name, maps)


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


@dataclass(frozen=True)
class Accounting:
    """What every rule reads: the tree's handlers and the edge's locations."""

    found: tuple[Handler, ...]
    where: tuple[Location, ...]
    root: Path
    conf: str


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
            f"{name} answers {handler.url}, which no exact match can name and no prefix location covers\n"
            f"{CONTINUATION}a dynamic segment is unmeterable without a prefix: give {conf} one, or the whole subtree runs unmetered",
        )
    return Finding(
        f"{name} answers {handler.url}, and no location in {conf} names it\n"
        f"{CONTINUATION}it reaches Next through `location /`, whose one rate zone meters server actions alone",
    )


# Every rule `main` runs, each over the whole accounting: a rule written and left out of this table is
# one nothing runs, which the table makes a reader's to see rather than a sequence of calls to miss.
RULES: Final = (account,)


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
        served = metadata(app_dir)
        where = edge_locations(conf_path)
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
    judged = Accounting(found, where, root, conf_path.name)
    findings = [finding for rule in RULES for finding in rule(judged)]

    code = report_findings(findings)
    if findings:
        print("\n      A route handler is a public URL, so the accounting is total: every one is either an")
        print("      exact-match location carrying limit_req, a prefix location with a recorded reason, or")
        print("      recorded at check_public_routes.py :: UNMETERED, and a metadata convention is taken")
        print("      unmetered where :: METADATA says why.")
        print("      The rule is docs/ops/spec.md, section 1.3.")
        return code

    metered = sum(1 for one in where if one.exact and one.metered)
    print(
        f"      {len(found)} route handler(s) accounted for, {len(served)} metadata convention(s) taken unmetered, "
        f"{metered} metered exact-match location(s), {len(REASONS)} recorded reason(s)"
    )
    return code


if __name__ == "__main__":
    sys.exit(run(main))
