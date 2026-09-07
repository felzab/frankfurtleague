"""SCRIPTS · one Content-Security-Policy per nginx file, at every block that sets any header.

`add_header` in a block REPLACES the inherited set rather than extending it
(`docs/ops/spec.md :: I2`), which costs a file two different ways: a block that sets some other
header and no policy serves what it proxies with none at all, and a copy edited alone ships a
different policy to whatever that block serves. Nothing else compares them. The pair ACROSS the two
files is somebody else's claim.

A block that redirects is asked for no policy — a 3xx carries no document for one to govern.

Refusals rather than passes, a line this reader cannot read not being a line it may call identical:
a declaration it cannot take one quoted policy out of, and a brace it cannot place.
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

from checker_kernel import (  # noqa: E402 -- the insert above is what resolves it
    CONTINUATION,
    EXIT_REFUSED,
    REPO_ROOT,
    Finding,
    report_findings,
    run,
)

CONFIG_DIR: Final = "nginx"
CONFIG_GLOB: Final = "*.conf"
HEADER: Final = "Content-Security-Policy"

# Two readers over one line: the first decides which lines are sites, and a site the second cannot
# read is what the refusal above is for.
DECLARING_RE: Final = re.compile(r"^\s*add_header\s+" + re.escape(HEADER) + r"\b")
POLICY_RE: Final = re.compile(r"^\s*add_header\s+" + re.escape(HEADER) + r'\s+"(?P<policy>[^"]*)"\s*(?:always\s*)?;\s*$')

# The block reader's three lines, over text already stripped of comments and indentation. The label
# is whatever precedes the brace, so a finding names `location /_next/static/` as the file spells it
# rather than as this reader classifies it.
ANY_HEADER_RE: Final = re.compile(r"^add_header\s")
BLOCK_OPEN_RE: Final = re.compile(r"^(?P<label>[^{}]*[^{}\s])\s*\{$")
REDIRECTING_RE: Final = re.compile(r"^return\s+3\d\d(\s|;)")


class Unreadable(Exception):
    """A declaration or a brace this reader cannot place, named with the line that carries it."""


@dataclass(frozen=True)
class Declaration:
    """One `add_header` site: where it is written, and the policy it sends."""

    line: int
    policy: str


def declarations(text: str, name: str) -> list[Declaration]:
    """Every site in one file that sets this header, in the order the file writes them."""
    found: list[Declaration] = []
    for number, line in enumerate(text.split("\n"), start=1):
        if DECLARING_RE.match(line) is None:
            continue
        match = POLICY_RE.match(line)
        if match is None:
            raise Unreadable(f"{name}:{number}: an add_header this reader cannot take one quoted policy out of")
        found.append(Declaration(number, match.group("policy")))
    return found


@dataclass(frozen=True)
class Block:
    """One brace block: where it opens, how the file names it, and what it does about headers."""

    line: int
    label: str
    headers: int
    policies: int
    redirects: bool


@dataclass
class _Frame:
    """A block still open. Mutable because its counts are what reading the body produces."""

    line: int
    label: str
    headers: int = 0
    policies: int = 0
    redirects: bool = False

    def sealed(self) -> Block:
        return Block(self.line, self.label, self.headers, self.policies, self.redirects)


def uncommented(raw: str) -> str:
    """The line with any trailing comment removed, quotes kept."""
    out: list[str] = []
    quote = ""
    for char in raw:
        if quote:
            out.append(char)
            if char == quote:
                quote = ""
            continue
        if char == "#":
            break
        if char in "\"'":
            quote = char
        out.append(char)
    return "".join(out).strip()


def unquoted(line: str) -> str:
    """The line's quoted spans blanked, its length kept so an index into it still lands.

    `log_format fl_json` writes JSON, so a reader taking braces from inside a value loses the
    nesting and charges every later header to the wrong block.
    """
    out: list[str] = []
    quote = ""
    for char in line:
        if quote:
            out.append(" ")
            if char == quote:
                quote = ""
            continue
        if char in "\"'":
            quote = char
            out.append(" ")
            continue
        out.append(char)
    return "".join(out)


def blocks(text: str, name: str) -> list[Block]:
    """Every brace block in one file, in the order they open, with its own body's counts alone."""
    found: list[Block] = []
    stack: list[_Frame] = []
    for number, raw in enumerate(text.split("\n"), start=1):
        line = uncommented(raw)
        if not line:
            continue
        skeleton = unquoted(line)
        if skeleton.startswith("}"):
            if not stack:
                raise Unreadable(f"{name}:{number}: a closing brace this reader has no open block for")
            found.append(stack.pop().sealed())
            continue
        opening = BLOCK_OPEN_RE.match(skeleton)
        if opening is not None:
            # The label off the ORIGINAL line, which `unquoted` blanked in place: a finding names
            # the block as the file spells it rather than as this reader lexed it.
            stack.append(_Frame(number, line[: opening.end("label")].strip()))
            continue
        if "{" in skeleton or "}" in skeleton:
            raise Unreadable(f"{name}:{number}: a brace this reader cannot place -- one block per pair of lines is the shape it reads")
        if not stack:
            continue
        # The innermost frame alone: nginx replaces the set for whatever enters a nested block, so
        # folding an `if`'s add_header up would read its location as covered by a policy it displaced.
        frame = stack[-1]
        if ANY_HEADER_RE.match(line):
            frame.headers += 1
            frame.policies += 1 if DECLARING_RE.match(line) else 0
        elif REDIRECTING_RE.match(line):
            frame.redirects = True
    if stack:
        raise Unreadable(f"{name}:{stack[-1].line}: a block this reader never saw closed")
    return sorted(found, key=lambda one: one.line)


def dropped(name: str, found: list[Block]) -> list[Finding]:
    """Every block that replaced the inherited header set and put no policy back (`docs/ops/spec.md :: I2`)."""
    return [
        Finding(
            "fail",
            f"{name}:{one.line} sets a header and no {HEADER}, so `{one.label}` serves without one\n"
            f"{CONTINUATION}an add_header here replaces the whole inherited set, this policy included",
        )
        for one in found
        if one.headers and not one.policies and not one.redirects
    ]


def disagreements(name: str, found: list[Declaration]) -> list[Finding]:
    """Every site whose policy is not the first one's, and the empty file as its own finding."""
    if not found:
        # A file the population offered and that sets no policy at all: the header is gone from
        # everything it serves, which is the loudest form of the defect rather than an exemption.
        return [
            Finding(
                "fail",
                f"{name} sets no {HEADER} at any site\n{CONTINUATION}every response this file serves goes out without one",
            )
        ]
    first = found[0]
    return [
        Finding(
            "fail",
            f"{name}:{one.line} sends a {HEADER} that {name}:{first.line} does not\n"
            f"{CONTINUATION}{first.line}: {first.policy}\n"
            f"{CONTINUATION}{one.line}: {one.policy}",
        )
        for one in found[1:]
        if one.policy != first.policy
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Is each nginx file's Content-Security-Policy the same at every site it is set?")
    parser.add_argument("--verbose", action="store_true", help="name every site as it is read")
    parser.add_argument("files", nargs="*", metavar="FILE", help=f"the configurations to read (default: {CONFIG_DIR}/{CONFIG_GLOB})")
    args = parser.parse_args()

    # The population is a directory listing, which is decided by no property this check asserts: a
    # file selected for declaring the header could never fail for declaring none (PRE-4).
    paths = [Path(name) for name in args.files] or sorted((REPO_ROOT / CONFIG_DIR).glob(CONFIG_GLOB))
    if not paths:
        print(f"      no configuration under {CONFIG_DIR}/ matched {CONFIG_GLOB}, so nothing was compared.", file=sys.stderr)
        print("      Nothing here stands as a verdict on the policy.", file=sys.stderr)
        return EXIT_REFUSED

    findings: list[Finding] = []
    sites = 0
    for path in paths:
        try:
            text = path.read_text(encoding="utf-8")
            found = declarations(text, path.name)
            structure = blocks(text, path.name)
        except Unreadable as error:
            print(f"      {error}", file=sys.stderr)
            print("      Nothing was compared, so this is a refusal rather than a verdict on the files.", file=sys.stderr)
            print("      Write the policy as one double-quoted argument and the braces balanced, or teach", file=sys.stderr)
            print("      scripts/checks/check_csp_identity.py :: POLICY_RE or :: blocks the shape.", file=sys.stderr)
            return EXIT_REFUSED
        except (OSError, UnicodeDecodeError) as error:
            print(f"      {error}", file=sys.stderr)
            # A file the checker cannot open is input it cannot judge, which the kernel's contract
            # calls EXIT_REFUSED. EXIT_CRASH would claim the environment is broken.
            print("      Nothing was compared: every configuration has to be readable for the comparison to mean anything.", file=sys.stderr)
            return EXIT_REFUSED
        sites += len(found)
        if args.verbose:
            for one in found:
                print(f"      read      {path.name}:{one.line}")
        findings += dropped(path.name, structure) + disagreements(path.name, found)

    code = report_findings(findings)
    if findings:
        print(f"\n      A {HEADER} written twice in one file is one policy, and every copy has to say it.")
        print("      Edit the copies together, or restate the whole set in the block that replaced it.")
        return code

    print(f"      {len(paths)} configuration(s) read, {sites} declaration(s), each file saying one thing")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
