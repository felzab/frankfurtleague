"""SCRIPTS · every Next route handler is accounted for against the edge's own locations.

A route handler is a public URL from the moment the file exists, and nothing else compares the App
Router tree to `nginx/prod.conf`: a handler no location names reaches Next through `location /`,
which carries no `limit_req`. The accounting is total rather than aimed at the public handlers
alone, because no predicate selects those, and `REASONS` carries the locations covering an unmetered
one (`docs/ops/spec.md`).

A construct this reader cannot place refuses rather than answering, and a reason covering no handler
is a finding.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final

# Every caller runs this as a script, so sys.path opens with THIS directory and `lib/` is a
# sibling of it rather than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import EXIT_REFUSED, REPO_ROOT, Finding, report_findings, run  # noqa: E402 -- the insert above is what resolves it

APP_ROUTER: Final = "fl_frontend/src/app"
NGINX_CONF: Final = "nginx/prod.conf"

# The whole App Router tree rather than `api/` alone: a handler filed outside that folder serves a
# URL just the same, and a walk that cannot see it accounts for nothing.

# All four extensions, because Next resolves a handler from any of them (`pageExtensions`): one
# filed as `route.tsx` answers its URL exactly as `route.ts` does.
ROUTE_FILES: Final = ("route.ts", "route.tsx", "route.js", "route.jsx")

# The column `checker_kernel.py :: report_findings` leaves after its `FAIL` tag, so a finding's second
# line lands under its first.
CONTINUATION: Final = " " * 14

# A prefix location matches on the URI string, so the catch-all covers every handler there is.
# Counting it as coverage would leave this check unable to fail.
CATCH_ALL: Final = "/"

# The character a canonical path and its twin differ by. Its own name, because a path ending in one
# is a pair of locations rather than anything to do with the catch-all above.
TRAILING_SLASH: Final = "/"

# No request URI starts with `@`, so a named location answers an internal redirect alone.
NAMED: Final = "@"


@dataclass(frozen=True)
class Reason:
    """One prefix location this accounting takes in place of a metered exact match, and why."""

    path: str
    why: str


# Every handler a prefix covers, named by that prefix rather than by itself: an allowlist of
# handlers would be a second copy of the route tree, stale the day a directory is renamed.
REASONS: Final[tuple[Reason, ...]] = (
    Reason("/api/admin/", "page-owned undo handlers, each authorizing itself behind the admin guard"),
    Reason("/api/auth", "Auth.js's catch-all, whose outbound-email trigger is metered at /api/auth/signin"),
)

# A route group is dropped from the URL; a dynamic segment and a catch-all stay, because what they
# make unmeterable is exactly what this check reports.
GROUP_RE: Final = re.compile(r"^\([^()/]+\)$")
DYNAMIC_RE: Final = re.compile(r"^\[\[?(?:\.\.\.)?[A-Za-z0-9_]+\]?\]$")
# A leading underscore is outside this class deliberately: Next opts such a folder out of routing
# altogether, so a handler under one answers no URL and the derivation has nothing to answer with.
LITERAL_RE: Final = re.compile(r"^[A-Za-z0-9.~-][A-Za-z0-9._~-]*$")


class NginxSyntax(Exception):
    """A construct outside the subset this reader parses, named with the line that carries it."""


class RouteShape(Exception):
    """A directory segment whose URL this reader cannot derive, named with the file under it."""


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
    metered: bool
    line: int

    def matches(self, uri: str) -> bool:
        """Whether this block answers `uri`, by nginx's own string comparison rather than by segment."""
        return self.path == uri if self.exact else uri.startswith(self.path)


@dataclass(frozen=True)
class Handler:
    """One `route.ts`, the URL it answers, and the part of that URL an exact match could name."""

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


def read_location(directive: Directive, source: str) -> Location:
    """One `location` block as this accounting reads it, refusing a modifier it cannot judge."""
    block = directive.block
    if block is None:
        raise NginxSyntax(f"{source}:{directive.line}: a location with no block under it")
    if any(child.name == "location" for child in block):
        raise NginxSyntax(f"{source}:{directive.line}: a location nested inside a location, whose match order this reader does not resolve")
    metered = any(child.name == "limit_req" for child in block)
    if len(directive.args) == 1:
        path = directive.args[0]
        # Refused rather than read as a prefix: `@fallback` would cover every handler whose URL
        # starts with it, which is none of them, and reading it as coverage is the one direction
        # this check may not fail in.
        if path.startswith(NAMED):
            raise NginxSyntax(f"{source}:{directive.line}: the named location {path!r}, which no request URI reaches")
        return Location(False, path, metered, directive.line)
    if len(directive.args) == 2:
        modifier, path = directive.args
        if modifier == "=":
            return Location(True, path, metered, directive.line)
        # `^~` still matches a prefix; a regex matches on something this reader cannot compare a
        # directory tree against, so it refuses rather than calling the handler uncovered.

        # `scripts/checks/check_nginx_mirror.py :: server_body` keys a regex location instead and
        # compares the pair as text, which asks nothing about the URLs one answers.
        if modifier == "^~":
            return Location(False, path, metered, directive.line)
        raise NginxSyntax(f"{source}:{directive.line}: the location modifier {modifier!r}, which selects by something other than a path prefix")
    raise NginxSyntax(f"{source}:{directive.line}: a location taking {len(directive.args)} argument(s)")


def locations(tree: tuple[Directive, ...], source: str) -> tuple[Location, ...]:
    """Every `location` of the one server block that declares any."""
    serving = [
        directive
        for directive in tree
        if directive.name == "server" and directive.block is not None and any(child.name == "location" for child in directive.block)
    ]
    if len(serving) != 1:
        raise NginxSyntax(
            f"{source}: {len(serving)} server blocks declare a location, and this reader cannot say which one answers a route handler"
        )
    block = serving[0].block or ()
    found = tuple(read_location(child, source) for child in block if child.name == "location")
    _declared_once(found, source)
    return found


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
        if GROUP_RE.match(part):
            continue
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


def account(found: tuple[Handler, ...], where: tuple[Location, ...], root: Path, conf: str) -> tuple[list[Finding], set[Reason]]:
    """Every handler judged against the locations, and the reasons a handler was actually charged to."""
    # One entry per path, `locations` having refused a second exact match on one.
    exact = {one.path: one for one in where if one.exact}
    findings: list[Finding] = []
    used: set[Reason] = set()
    for handler in found:
        name = shown(handler.path, root)
        match = None if handler.dynamic else exact.get(handler.url)
        if match is not None:
            if not match.metered:
                findings.append(
                    Finding(
                        "fail",
                        f"{name} answers {handler.url}, whose exact-match location carries no limit_req\n"
                        f"{CONTINUATION}an exact match is where a rate is declared, and {conf} declares none there",
                    )
                )
            continue
        prefix = covering_prefix(handler.head, where)
        if prefix is None:
            findings.append(_unreached(handler, name, conf))
            continue
        reason = declaring(prefix.path)
        if reason is None:
            findings.append(
                Finding(
                    "fail",
                    f"{name} answers {handler.url}, covered by the prefix location {prefix.path} and by no recorded reason\n"
                    f"{CONTINUATION}meter it with an exact-match location, or record why that prefix is enough at "
                    f"scripts/checks/check_public_routes.py :: REASONS",
                )
            )
            continue
        used.add(reason)
    return findings, used


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
        f"{CONTINUATION}it reaches Next through `location /`, which carries limit_conn and no limit_req",
    )


def unused(used: set[Reason], where: tuple[Location, ...]) -> list[Finding]:
    """Every recorded reason that charged no handler -- the accounting rotting the other way."""
    declared = {one.path for one in where if not one.exact}
    return [
        Finding(
            "fail",
            f"the recorded reason for {reason.path} ({reason.why}) covered nothing\n"
            f"{CONTINUATION}"
            + (
                "no handler is charged to that location any more"
                if reason.path in declared
                else "no prefix location declares that path any more"
            ),
        )
        for reason in REASONS
        if reason not in used
    ]


def twins(where: tuple[Location, ...]) -> list[Finding]:
    """Every metered exact match whose trailing-slash counterpart is missing.

    The pair costs no correctness, Next answering the slashed form with a 308; what it closes is the
    unmetered upstream work (`docs/ops/spec.md`).
    """
    metered = {one.path for one in where if one.exact and one.metered}
    findings: list[Finding] = []
    for path in sorted(metered):
        if path.endswith(TRAILING_SLASH):
            canonical = path[: -len(TRAILING_SLASH)]
            if canonical and canonical not in metered:
                findings.append(_twinless(path, canonical, "canonical"))
        elif path + TRAILING_SLASH not in metered:
            findings.append(_twinless(path, path + TRAILING_SLASH, "trailing-slash twin"))
    return findings


def _twinless(path: str, missing: str, role: str) -> Finding:
    """The finding for one half of a trailing-slash pair standing alone."""
    return Finding(
        "fail",
        f"{path} is metered and its {role} {missing} is not\n"
        f"{CONTINUATION}an exact match is exact, so the other form falls to `location /` and reaches Next unmetered",
    )


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
        # Bytes, so no platform's newline translation reaches a path this reader then compares.
        where = locations(parse(conf_path.read_bytes().decode("utf-8"), conf_path.name), conf_path.name)
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

    findings, used = account(found, where, root, conf_path.name)
    findings += unused(used, where) + twins(where)

    code = report_findings(findings)
    if findings:
        print("\n      A route handler is a public URL, so the accounting is total: every one is either an")
        print("      exact-match location carrying limit_req, or a prefix location with a recorded reason.")
        print("      The rule is docs/ops/spec.md, section 1.3; the reasons are check_public_routes.py :: REASONS.")
        return code

    metered = sum(1 for one in where if one.exact and one.metered)
    print(f"      {len(found)} route handler(s) accounted for, {metered} metered exact-match location(s), {len(REASONS)} recorded reason(s)")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
