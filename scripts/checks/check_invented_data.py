"""Every address, site and telephone number a test spells out is one no third party holds.

A test's made-up person reaches a log line, a stored row and a mailer's stand-in, and a domain anyone
may register or a number a carrier may assign names a stranger there. So a test invents them from
names and numbers set aside for the purpose:

- RFC 2606 reserves example.com, example.net and example.org, and the top-level domains .example,
  .test and .invalid (https://www.rfc-editor.org/rfc/rfc2606); RFC 6761 reserves .localhost and RFC
  6762 .local. IANA holds the IDN test domain xn--zckzah (https://www.iana.org/domains/reserved),
  the one a case needing a punycode top-level domain names. The league's own domain is no third
  party's.
- The Bundesnetzagentur keeps (0)69 90009 000 to 999, (0)171 39200 00 to 99 and (0)176 040690 00 to
  99 unassigned for media productions
  (https://bundesnetzagentur.de/DE/Fachthemen/Telekommunikation/Nummerierung/DramaNumbers/artikel.html).

The population is every tracked test file of both tiers. Three rules read it:

- an email address's domain, written after the address's at sign, a template's placeholder labels
  included;
- a quoted http(s) address's host, the real services the code calls and the league's own pages
  aside; a host with no dot, an address literal and a version string name no registrable domain;
- a quoted German telephone number, `+49`, `0049`, or a trunk zero with a separator, folded as the
  API folds one, whose digits must lie in one of the three ranges. A number cut short or completed by
  a placeholder is judged on the digits it holds.

A value built from parts is judged only where some test spells it whole: a domain held in a constant
and joined to a name after the at sign reads as no address, and a bare host literal meets no rule.

A file this reader cannot decode refuses, and so does an empty population: either would read as a pass.
"""

from __future__ import annotations

import re
import subprocess
import sys
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final

# Run by hand, a script's sys.path opens with its own directory, and `lib/` is a sibling of it rather
# than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import CONTINUATION, EXIT_REFUSED, REPO_ROOT, UNREADABLE, ArgumentParser, Finding, report_findings, run

# Every tracked file a test of either tier invents its data in, as `git ls-files` reads a pathspec.
TEST_FILES: Final = (
    "fl_backend/tests",
    "fl_frontend/src/**/*.test.ts",
    "fl_frontend/src/**/*.test.tsx",
    "fl_frontend/src/test-support",
    "fl_frontend/e2e",
)

RESERVED_DOMAINS: Final = ("example.com", "example.net", "example.org", "frankfurtleague.de")
RESERVED_TOP_LEVEL: Final = ("example", "test", "invalid", "localhost", "local", "xn--zckzah")

# Real hosts a test names because the code calls them or links them, each with its reason.
NAMED_HOSTS: Final[Mapping[str, str]] = {
    "challenges.cloudflare.com": "Turnstile's script, which the pages load",
    "api.resend.com": "the mailer's API, which the delivery client calls",
    "www.instagram.com": "the league's own account",
    "www.threads.net": "the league's own account",
    "www.sptg.de": "the sponsor the league's pages link",
}

# Hosts a URL rule's case refuses for its shape, no domain reaching a stranger.
REFUSED_SHAPES: Final[Mapping[str, str]] = {
    "a.bc": "a URL whose top-level domain is delegated nowhere",
}

# Each range's leading digits after the trunk zero, and the length of a whole number in it.
MEDIA_RANGES: Final = (("06990009", 11), ("017139200", 11), ("0176040690", 12))

# Spellings the telephone rule's own cases need outside every range, each with its reason.
KEPT_NUMBERS: Final[Mapping[str, str]] = {
    "0491 234567": "a national number whose area code begins 49, which no media range has",
    "+49 1 234567": "no assignable number, the other half of that case",
}

# A label's characters, a template's placeholder (`{name}`, `${name}`) standing for one or more.
_LABEL: Final = r"(?:[\w\-]|\$?\{[^{}\n]*\})+"
_HOST: Final = rf"{_LABEL}(?:\.{_LABEL})+"
# The at sign after a local part, a quote or a placeholder: a decorator's or an import's at sign
# follows a blank, a slash or the backtick a comment quotes it in.
ADDRESS: Final = re.compile(rf"(?<=[\w.+\-'\"}}])@({_HOST})")
URL: Final = re.compile(rf"(?<=[\"'`])https?://(?:[^\s/@\"'`]*@)?({_HOST})")
# A quoted string a telephone number could be: a country code, or a trunk zero.
QUOTED: Final = re.compile(r"([\"'`])((?:\+49|0049|\(?0[1-9])[^\"'`\n]*)\1")
# What a source writes inside the quotes besides the digits: an escape a test types a control
# character with, and a placeholder.
_ESCAPE: Final = re.compile(r"\\(?:x[0-9a-fA-F]{2}|[tnrv])")
_PLACEHOLDER: Final = re.compile(r"\$?\{[^{}\n]*\}")
# A dot only at the end, so a date written with dots is no number.
_NUMBER_SHAPE: Final = re.compile(r"[0-9+ ()/\-]*[0-9]\.?")
_COUNTRY_CODES: Final = ("0049", "49")


@dataclass(frozen=True)
class Spot:
    """One value a rule judges, where it stands."""

    path: str
    line: int
    value: str


def top_level(host: str) -> str:
    return host.rstrip(".").rpartition(".")[2]


def names_a_domain(host: str) -> bool:
    """Whether `host` ends in a label a delegated top-level domain could be: letters, or punycode."""

    # A package's version, `name@1.22.1.patch`, opens with two numeric labels.
    if re.match(r"\d+\.\d+\.", host):
        return False
    last = top_level(host)
    return bool(re.fullmatch(r"[^\W\d_]+|xn--[a-z0-9\-]+", last, re.IGNORECASE)) or bool(_PLACEHOLDER.fullmatch(last))


def reserved(host: str) -> bool:
    folded = host.rstrip(".").lower()
    if top_level(folded) in RESERVED_TOP_LEVEL:
        return True
    return any(folded == name or folded.endswith(f".{name}") for name in RESERVED_DOMAINS)


def folded_digits(spelled: str) -> str:
    """The digits a telephone number folds to, a leading country code folded back to the trunk zero."""

    digits = re.sub(r"[^0-9]", "", spelled)
    for country_code in _COUNTRY_CODES:
        if digits.startswith(country_code):
            return f"0{digits.removeprefix(country_code).removeprefix('0')}"
    return digits


def in_a_media_range(digits: str, *, completed: bool) -> bool:
    """Whether `digits` can only be a number of a range: a cut of its leading digits, or a whole one.

    `completed`, where a placeholder follows, admits any length up to a whole number.
    """

    for head, length in MEDIA_RANGES:
        if head.startswith(digits):
            return True
        if digits.startswith(head) and (len(digits) == length or (completed and len(digits) <= length)):
            return True
    return False


def number_spots(text: str, path: str) -> Iterable[tuple[Spot, str, bool]]:
    """Every quoted telephone number in `text`, with its known digits and whether a placeholder completes it."""

    for hit in QUOTED.finditer(text):
        written = hit.group(2)
        bare = _ESCAPE.sub(" ", written)
        head = _PLACEHOLDER.split(bare, maxsplit=1)[0]
        completed = _PLACEHOLDER.search(bare) is not None
        if not _NUMBER_SHAPE.fullmatch(head.strip() or "x"):
            continue
        # A national spelling with no separator is a digit string as much as a number: a date, an id.
        if not head.startswith(("+", "00")) and not re.search(r"[ ()/\-]", head):
            continue
        digits = folded_digits(head)
        if len(digits) < 6 and not completed:
            continue
        yield Spot(path, text.count("\n", 0, hit.start()) + 1, written), digits, completed


def judge(text: str, path: str) -> list[Finding]:
    findings: list[Finding] = []
    rules: tuple[tuple[re.Pattern[str], str, Mapping[str, str]], ...] = (
        (ADDRESS, "address", {}),
        (URL, "site", {**NAMED_HOSTS, **REFUSED_SHAPES}),
    )
    for pattern, kind, aside in rules:
        for hit in pattern.finditer(text):
            host = hit.group(1)
            if not names_a_domain(host) or reserved(host) or host.lower() in aside:
                continue
            line = text.count("\n", 0, hit.start()) + 1
            findings.append(Finding(f"{path}:{line}: the {kind} host {host} is no reserved name"))
    for spot, digits, completed in number_spots(text, path):
        if spot.value in KEPT_NUMBERS or in_a_media_range(digits, completed=completed):
            continue
        findings.append(Finding(f"{spot.path}:{spot.line}: the telephone number {spot.value} lies in no media range"))
    return findings


class Unreadable(Exception):
    """A file of the population this reader cannot decode."""


def population(root: Path) -> list[Path]:
    """Every tracked test file under `root`, which must be a git work tree."""

    listed = subprocess.run(["git", "-C", str(root), "ls-files", "-z", "--", *TEST_FILES], capture_output=True, check=True).stdout.decode(
        "utf-8"
    )
    return [root / name for name in listed.split("\0") if name]


def shown(path: Path) -> str:
    """`path` as a finding names it: from the repository's root where it lies inside."""

    resolved = path.resolve()
    return resolved.relative_to(REPO_ROOT).as_posix() if resolved.is_relative_to(REPO_ROOT) else path.as_posix()


def read(path: Path) -> str:
    try:
        return path.read_bytes().decode("utf-8")
    except UNREADABLE as error:
        raise Unreadable(f"{path}: {type(error).__name__}") from None


def main() -> int:
    parser = ArgumentParser(description="Does every test invent its addresses, sites and numbers from reserved ones?")
    parser.add_argument("files", nargs="*", metavar="FILE", help="the files to judge (default: every tracked test file of both tiers)")
    args = parser.parse_args()

    files = [Path(name) for name in args.files] or population(REPO_ROOT)
    if not files:
        print("      No test file was found, so nothing was judged: a refusal rather than a pass.", file=sys.stderr)
        return EXIT_REFUSED
    try:
        findings = [finding for path in files for finding in judge(read(path), shown(path))]
    except Unreadable as error:
        print(f"      {error}", file=sys.stderr)
        print("      A file could not be read, so this is a refusal rather than a pass.", file=sys.stderr)
        return EXIT_REFUSED

    code = report_findings(findings)
    if findings:
        print("\n      A test invents an address on example.com, .net or .org or under .example, .test or .invalid")
        print("      (RFC 2606), and a telephone number from the Bundesnetzagentur's ranges for media productions:")
        print("      (0)69 90009 000-999, (0)171 39200 00-99, (0)176 040690 00-99. A real host the code calls is")
        print(f"      named at check_invented_data.py :: NAMED_HOSTS,\n{CONTINUATION}with its reason.")
        return code

    print(f"      {len(files)} test file(s) judged, every address, site and telephone number reserved")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
