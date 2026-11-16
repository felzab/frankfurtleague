"""nginx's configuration as a tree of directives, read once for every reader under `scripts/` and the edge test.

A construct outside the subset this reader parses raises `NginxSyntax` rather than answering, and each
query below refuses with the kernel's `EXIT_REFUSED` where the file does not say what it asks: a reader
guessing past a spelling it cannot read would grade the edge on a figure nobody wrote.

Run as a script, it answers the edge test's questions about the files it serves, each on stdout as bytes,
so no Windows text stream adds a carriage return to a value the test compares.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from checker_kernel import EXIT_OK, EXIT_REFUSED, run


class NginxSyntax(Exception):
    """A construct outside the subset this reader parses, named with the line that carries it."""


@dataclass(frozen=True)
class Directive:
    """One nginx directive: its name, its arguments, and the block under it where it opens one."""

    name: str
    args: tuple[str, ...]
    block: tuple[Directive, ...] | None
    line: int


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


def read(path: Path) -> tuple[Directive, ...]:
    """A file's directives. Bytes, so no platform's newline translation reaches a value a reader compares."""
    return parse(path.read_bytes().decode("utf-8"), path.name)


def walk(tree: tuple[Directive, ...]) -> Iterator[Directive]:
    """Every directive of the tree at every depth, in the order the file writes them."""
    for directive in tree:
        yield directive
        if directive.block is not None:
            yield from walk(directive.block)


def location(tree: tuple[Directive, ...], spelled: str, source: str) -> Directive:
    """The `location` block whose arguments read `spelled`, such as `/` or `= /api/client-error`."""
    found = [one for one in tree if one.name == "location" and " ".join(one.args) == spelled and one.block is not None]
    if len(found) != 1:
        raise NginxSyntax(f"{source}: {len(found)} blocks read `location {spelled}`, where this reader wants one")
    return found[0]


def map_default(tree: tuple[Directive, ...], variable: str, source: str) -> str:
    """The default of the `map` setting `variable`."""
    for directive in tree:
        if directive.name == "map" and directive.args[-1:] == (variable,) and directive.block is not None:
            values = [entry.args[0] for entry in directive.block if entry.name == "default" and len(entry.args) == 1]
            if len(values) == 1:
                return values[0]
    raise NginxSyntax(f"{source}: no map with one default sets {variable}")


def headers(sent: tuple[Directive, ...], http: tuple[Directive, ...], source: str, http_source: str) -> list[tuple[str, str]]:
    """Each `add_header` of the set as its name, lower-cased, and its value, a variable read as its map's default."""
    found: list[tuple[str, str]] = []
    for directive in sent:
        if directive.name != "add_header":
            continue
        if len(directive.args) != 3 or directive.args[2] != "always":
            raise NginxSyntax(f"{source}:{directive.line}: an add_header whose name and value this reader cannot read")
        name, value, _ = directive.args
        found.append((name.lower(), map_default(http, value, http_source) if value.startswith("$") else value))
    if not found:
        raise NginxSyntax(f"{source}: no add_header to compare")
    return found


def figure(block: Directive, directive: str, zone: str, source: str) -> int:
    """The burst of a block's `limit_req` on `zone`, or the figure of its `limit_conn` on it."""
    for child in block.block or ():
        if child.name != directive:
            continue
        if directive == "limit_req" and f"zone={zone}" in child.args:
            bursts = [arg.removeprefix("burst=") for arg in child.args if arg.startswith("burst=")]
            if len(bursts) == 1 and bursts[0].isdigit():
                return int(bursts[0])
        if directive == "limit_conn" and len(child.args) == 2 and child.args[0] == zone and child.args[1].isdigit():
            return int(child.args[1])
    raise NginxSyntax(f"{source}:{block.line}: `location {' '.join(block.args)}` declares no {directive} figure on {zone} this reader can read")


def returned(block: Directive, status: str, source: str) -> str:
    """What a block's `return <status>` answers, its text as the file writes it."""
    found = [child.args[1] for child in block.block or () if child.name == "return" and len(child.args) == 2 and child.args[0] == status]
    if len(found) != 1:
        raise NginxSyntax(f"{source}:{block.line}: `location {' '.join(block.args)}` returns no single {status} body")
    return found[0]


def _emit(text: str) -> None:
    sys.stdout.flush()
    sys.stdout.buffer.write(text.encode("utf-8"))
    sys.stdout.buffer.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description="Answer the edge test's questions about the configuration it serves.")
    queries = parser.add_subparsers(dest="query", required=True)
    one = queries.add_parser("headers", help="each security header as `name<TAB>value`")
    one.add_argument("headers_file", type=Path)
    one.add_argument("http_file", type=Path)
    one = queries.add_parser("locations", help="each top-level location as `arguments<TAB>zones`")
    one.add_argument("file", type=Path)
    one = queries.add_parser("figure", help="a location's limit_req burst or limit_conn figure on a zone")
    one.add_argument("file", type=Path)
    one.add_argument("location")
    one.add_argument("directive", choices=("limit_req", "limit_conn"))
    one.add_argument("zone")
    one = queries.add_parser("returned", help="what a location's `return <status>` answers, as written")
    one.add_argument("file", type=Path)
    one.add_argument("location")
    one.add_argument("status")
    one = queries.add_parser("directives", help="every directive of each file as `file<TAB>name arguments`")
    one.add_argument("files", type=Path, nargs="+")
    args = parser.parse_args()
    try:
        if args.query == "headers":
            _emit(
                "".join(
                    f"{name}\t{value}\n"
                    for name, value in headers(read(args.headers_file), read(args.http_file), args.headers_file.name, args.http_file.name)
                )
            )
        elif args.query == "locations":
            lines = []
            for block in read(args.file):
                if block.name == "location":
                    zones = sorted(
                        arg.removeprefix("zone=")
                        for child in block.block or ()
                        if child.name == "limit_req"
                        for arg in child.args
                        if arg.startswith("zone=")
                    )
                    lines.append(f"{' '.join(block.args)}\t{','.join(zones)}\n")
            _emit("".join(lines))
        elif args.query == "figure":
            _emit(f"{figure(location(read(args.file), args.location, args.file.name), args.directive, args.zone, args.file.name)}\n")
        elif args.query == "returned":
            _emit(returned(location(read(args.file), args.location, args.file.name), args.status, args.file.name))
        else:
            _emit("".join(f"{path.as_posix()}\t{' '.join((one.name, *one.args))}\n" for path in args.files for one in walk(read(path))))
    except (NginxSyntax, OSError, UnicodeDecodeError) as error:
        print(f"      {error}", file=sys.stderr)
        return EXIT_REFUSED
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(run(main))
