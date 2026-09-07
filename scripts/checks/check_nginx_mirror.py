"""SCRIPTS · nginx/local.conf mirrors nginx/prod.conf, except where it declares otherwise.

`nginx -t` accepts either file whatever it says and neither reads the other, so a block production
gains and local does not is a difference the local stack can never catch — which is the whole value
of verifying against it. A construct outside the parsed subset refuses rather than answering, and a
declared delta matching no difference is a finding.

Invariants:
Every difference is declared or it is a finding, and every declaration covers a difference.
A `server` block is matched across the files by its role, never by its position or its name.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

# Every caller runs this as a script, so sys.path opens with THIS directory and `lib/` is a
# sibling of it rather than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import (  # noqa: E402 -- the insert above is what resolves it
    ABSENT,
    ANY,
    CONTINUATION,
    EXIT_REFUSED,
    REPO_ROOT,
    Delta,
    Difference,
    Finding,
    Marker,
    declaring,
    diff,
    report_findings,
    run,
    uncovered,
)

PROD: Final = "nginx/prod.conf"
LOCAL: Final = "nginx/local.conf"

NO_TLS: Final = "the local stack terminates no TLS"

# The address `docker-compose.yml` gives the tunnel connector, which is the whole of what production
# trusts a client address from.
TUNNEL: Final = "172.30.0.250"

# Cloudflare's published ranges as `nginx/local.conf` writes them, in its order. Spelled out rather
# than left free: the local stack keeps the published set by decision, so a range dropped from it
# is a finding rather than an allowed difference.
CLOUDFLARE_RANGES: Final[tuple[str, ...]] = (
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
    "2400:cb00::/32",
    "2606:4700::/32",
    "2803:f800::/32",
    "2405:b500::/32",
    "2405:8100::/32",
    "2a06:98c0::/29",
    "2c0f:f248::/32",
)

# Sorted, `set_real_ip_from` being one of `scripts/checks/check_nginx_mirror.py :: ORDER_FREE` and
# a pin being compared against what that produced.
LOCAL_TRUSTED: Final = tuple(sorted((one,) for one in CLOUDFLARE_RANGES))

# In source order instead, `scripts/checks/check_nginx_mirror.py :: arms` keeping a `geo` body as
# the sequence nginx reads it.
PROD_FALLBACK_ARMS: Final = (("default", "0"), (f"{TUNNEL}/32", "1"))
LOCAL_FALLBACK_ARMS: Final = (("default", "0"), *((one, "1") for one in CLOUDFLARE_RANGES))

# Pinned wherever both files write the directive, so a moved port or hostname is a finding rather
# than an allowed difference. ANY where only production writes it: its ciphers and certificate
# paths are production's business, not the mirror's.
DECLARED_DELTAS: Final[tuple[Delta, ...]] = (
    # Both sides verbosely, this pair being the trust boundary: ANY on either would accept a
    # narrowed local file or a production one widened back to every customer's egress.
    Delta(
        "set_real_ip_from",
        ((TUNNEL,),),
        LOCAL_TRUSTED,
        "production trusts the tunnel connector alone; nothing stands in front of the local stack, so it keeps Cloudflare's published ranges",
    ),
    Delta(
        "geo[$realip_fallback].arms",
        PROD_FALLBACK_ARMS,
        LOCAL_FALLBACK_ARMS,
        "the second copy of the trusted set, narrowed with it; both files keep the block so `log_format fl_json` keeps the field",
    ),
    Delta(
        "server[redirect:frankfurtleague.de www.frankfurtleague.de]",
        ANY,
        ABSENT,
        "production's plaintext redirect to HTTPS, which needs an HTTPS to send anyone to",
    ),
    Delta(
        "server[redirect:www.frankfurtleague.de]",
        ANY,
        ABSENT,
        "production's www-to-apex redirect; the local stack answers one name and mounts no certificate covering a second",
    ),
    Delta(
        "server[catch-all].listen",
        (("443", "ssl", "default_server"), ("[::]:443", "ssl", "default_server")),
        (("80", "default_server"), ("[::]:80", "default_server")),
        NO_TLS,
    ),
    Delta("server[catch-all].ssl_reject_handshake", ANY, ABSENT, "refusing a handshake needs a handshake to refuse"),
    Delta("server[catch-all].return", ABSENT, ANY, "the plaintext refusal local.conf spells where production drops the connection"),
    Delta("server[catch-all].access_log", ABSENT, ANY, "a rejected handshake produces no request to log; a 421 does"),
    Delta("server[main].listen", (("443", "ssl"), ("[::]:443", "ssl")), (("80",), ("[::]:80",)), NO_TLS),
    Delta("server[main].http2", ANY, ABSENT, "HTTP/2 is negotiated in the TLS handshake here"),
    Delta("server[main].server_name", (("frankfurtleague.de",),), (("localhost", "127.0.0.1"),), "the names each stack answers for"),
    Delta("server[main].ssl_certificate", ANY, ABSENT, NO_TLS),
    Delta("server[main].ssl_certificate_key", ANY, ABSENT, NO_TLS),
    Delta("server[main].ssl_protocols", ANY, ABSENT, NO_TLS),
    Delta("server[main].ssl_ciphers", ANY, ABSENT, NO_TLS),
    Delta("server[main].ssl_prefer_server_ciphers", ANY, ABSENT, NO_TLS),
    Delta("server[main].ssl_session_cache", ANY, ABSENT, NO_TLS),
    Delta("server[main].ssl_session_timeout", ANY, ABSENT, NO_TLS),
    Delta("server[main].ssl_session_tickets", ANY, ABSENT, NO_TLS),
    Delta("server[main].ssl_stapling", ANY, ABSENT, NO_TLS),
    Delta("server[main].ssl_stapling_verify", ANY, ABSENT, NO_TLS),
    Delta("server[main].resolver", ANY, ABSENT, "OCSP stapling's resolver, and there is no stapling without TLS"),
    Delta("server[main].resolver_timeout", ANY, ABSENT, "OCSP stapling's resolver, and there is no stapling without TLS"),
)


class NginxSyntax(Exception):
    """A construct outside the subset this reader parses, named with the line that carries it."""


@dataclass(frozen=True)
class Token:
    """One word or one of the `;{}` delimiters, with the line the word started on."""

    text: str
    line: int
    delimiter: bool


DELIMITERS: Final = ";{}"

# nginx drops the backslash before a quote or another backslash and renders these three, leaving
# every other pair alone -- which is why `\d` inside a quoted regex arm still means a digit.
ESCAPES: Final = {"t": "\t", "r": "\r", "n": "\n"}

# The blocks these two files use. Anything else opening a brace is refused rather than skipped: an
# `if` or an `upstream` decides routing, and a reader that walks past one may not call the pair equal.
BLOCKS: Final = ("server", "location", "map", "geo")

# Each name against the leading arguments nginx tells one repetition from another by. Repetitions
# compare sorted on that identity; two sharing one keep source order, a repeated header field name
# being emitted in it (`docs/ops/spec.md`).
ORDER_FREE: Final[dict[str, int]] = {
    "add_header": 1,
    "limit_req": 1,
    "limit_req_zone": 2,
    "listen": 1,
    "proxy_set_header": 1,
    "set_real_ip_from": 1,
}

# nginx runs the rewrite module in source order, and `directives` keys a level by name, keeping no
# order between two names. A level writing two of these names is refused rather than compared as a
# set nginx never applied.
SEQUENCED: Final = frozenset({"break", "return", "rewrite", "set"})

LOCATION_PREFIX: Final = "location["

# An arm's key is a pattern, an address or `default`; a bare lowercase word is the shape of a
# directive name instead, and `include` written there names arms this reader never read.
ARM_KEY_RE: Final = re.compile(r"^[a-z_]+$")

# What a catch-all writes, in the shape `scripts/checks/check_nginx_mirror.py :: directives` stores
# every directive: one argument list.
CATCH_ALL_NAME: Final = (("_",),)


def tokenize(text: str, source: str) -> list[Token]:
    """Words and the `;{}` delimiters, comments dropped and a quoted run folded into its word."""
    tokens: list[Token] = []
    word: list[str] = []
    # Separate from `word` being non-empty, or the empty argument in `proxy_set_header X-FL-Actor ""`
    # would produce no token at all and the directive would compare as one argument shorter.
    pending = False
    started = 1
    quote = ""
    line = 1
    index = 0
    while index < len(text):
        char = text[index]
        index += 1
        if char == "\n":
            line += 1
        if quote:
            if char == "\\" and index < len(text):
                following = text[index]
                index += 1
                if following == "\n":
                    line += 1
                if following in "\"'\\":
                    word.append(following)
                elif following in ESCAPES:
                    word.append(ESCAPES[following])
                else:
                    word.extend((char, following))
                continue
            if char == quote:
                quote = ""
                continue
            word.append(char)
            continue
        if char == "#":
            while index < len(text) and text[index] != "\n":
                index += 1
            continue
        if char in "\"'":
            if not pending:
                started, pending = line, True
            quote = char
            continue
        if char.isspace():
            if pending:
                tokens.append(Token("".join(word), started, False))
                word, pending = [], False
            continue
        if char in DELIMITERS:
            if pending:
                tokens.append(Token("".join(word), started, False))
                word, pending = [], False
            tokens.append(Token(char, line, True))
            continue
        if not pending:
            started, pending = line, True
        word.append(char)
    if quote:
        raise NginxSyntax(f"{source}:{started}: a quoted string that never closes")
    # Flushed rather than refused here: a file ending mid-word has a directive with no `;`, which
    # `scripts/checks/check_nginx_mirror.py :: parse_section` already reports for every other way
    # it can happen.
    if pending:
        tokens.append(Token("".join(word), started, False))
    return tokens


@dataclass(frozen=True)
class Block:
    """A brace-delimited block: its own name and arguments, and everything inside it."""

    name: str
    args: tuple[str, ...]
    body: Section
    line: int


@dataclass(frozen=True)
class Section:
    """One nesting level, its directives in source order with the line each began on.

    The order because a `map` body's arms are ordered and rewrites run in it; the line because a
    refusal has to name where it stands.
    """

    directives: tuple[tuple[str, tuple[str, ...], int], ...]
    blocks: tuple[Block, ...]


def parse_section(tokens: list[Token], index: int, source: str, *, top: bool) -> tuple[Section, int]:
    """One level's directives and blocks, and the index of the first token after it."""
    directives: list[tuple[str, tuple[str, ...], int]] = []
    blocks: list[Block] = []
    words: list[Token] = []
    while index < len(tokens):
        token = tokens[index]
        index += 1
        if not token.delimiter:
            words.append(token)
            continue
        if token.text == "}":
            if top:
                raise NginxSyntax(f"{source}:{token.line}: a block closes without opening")
            if words:
                raise NginxSyntax(f"{source}:{words[0].line}: {words[0].text!r} is not terminated by `;`")
            return Section(tuple(directives), tuple(blocks)), index
        if not words:
            raise NginxSyntax(f"{source}:{token.line}: a bare {token.text!r} naming no directive")
        if token.text == ";":
            directives.append((words[0].text, tuple(one.text for one in words[1:]), words[0].line))
        else:
            body, index = parse_section(tokens, index, source, top=False)
            blocks.append(Block(words[0].text, tuple(one.text for one in words[1:]), body, words[0].line))
        words = []
    if not top:
        raise NginxSyntax(f"{source}: a block that never closes")
    if words:
        raise NginxSyntax(f"{source}:{words[0].line}: {words[0].text!r} is not terminated by `;`")
    return Section(tuple(directives), tuple(blocks)), index


def directives(section: Section, source: str) -> dict[str, tuple[tuple[str, ...], ...]]:
    """Each directive name against its argument lists, in source order unless `ORDER_FREE` frees it.

    nginx runs a `rewrite` in the order it is written, so a pair reordered between the two files
    routes differently while still comparing equal.
    """
    collected: dict[str, list[tuple[str, ...]]] = {}
    ordered: tuple[str, int] | None = None
    for name, args, line in section.directives:
        if name == "include":
            raise NginxSyntax(f"{source}:{line}: `include` names a file this reader does not open")
        if name in SEQUENCED:
            if ordered is None:
                ordered = (name, line)
            elif ordered[0] != name:
                raise NginxSyntax(
                    f"{source}:{line}: `{name}` and the `{ordered[0]}` at {source}:{ordered[1]} run in the order "
                    f"they are written, which this reader keys by name and does not keep"
                )
        collected.setdefault(name, []).append(args)
    return {name: _repetitions(name, args) if name in ORDER_FREE else tuple(args) for name, args in collected.items()}


def _repetitions(name: str, args: list[tuple[str, ...]]) -> tuple[tuple[str, ...], ...]:
    """One order-free directive's repetitions, sorted on the identity `ORDER_FREE` gives its name.

    Stable, so two sharing an identity stay in the order nginx applies them in.
    """
    width = ORDER_FREE[name]
    return tuple(sorted(args, key=lambda one: one[:width]))


def arms(block: Block, source: str) -> tuple[tuple[str, str], ...]:
    """A `map` or `geo` body in source order, nginx testing a regex arm in the order it is written."""
    if block.body.blocks:
        # The nested block's own line, not the `map`'s: the fallback body runs to twenty-odd arms,
        # and a refusal naming its opening line leaves the reader hunting for the construct.
        raise NginxSyntax(f"{source}:{block.body.blocks[0].line}: a block inside `{block.name}`, which holds arms alone")
    entries: list[tuple[str, str]] = []
    for name, args, line in block.body.directives:
        # `hostnames;` and `volatile;` change what the block means and carry no value to compare.
        if len(args) != 1:
            raise NginxSyntax(f"{source}:{line}: `{name}` in `{block.name}` is not a pattern and a value")
        # An `include` has an arm's shape, a name and one argument, so only the key tells a directive
        # from an arm here; one read as a pattern would compare as an arm where a whole body went
        # unopened.
        if name != "default" and ARM_KEY_RE.match(name):
            raise NginxSyntax(f"{source}:{line}: `{name}` in `{block.name}` reads as a directive rather than an arm")
        entries.append((name, args[0]))
    return tuple(entries)


def keyed(node: dict[str, Any], key: str, value: Any, source: str, line: int) -> None:
    """Place a block under its key, refusing a second block that would silently replace the first."""
    if key in node:
        raise NginxSyntax(f"{source}:{line}: a second `{key}`, and this reader cannot tell them apart")
    node[key] = value


def location_body(block: Block, source: str) -> dict[str, Any]:
    """One `location`'s directives. A nested `location` is refused: this model has no room for one."""
    if block.body.blocks:
        raise NginxSyntax(f"{source}:{block.line}: a block inside a `location`, which this reader does not place")
    return directives(block.body, source)


def server_body(block: Block, source: str) -> dict[str, Any]:
    """One `server`'s directives and its `location` children, each under its modifier and path."""
    node: dict[str, Any] = dict(directives(block.body, source))
    for child in block.body.blocks:
        if child.name != "location":
            raise NginxSyntax(f"{source}:{child.line}: `{child.name}` opens a block this reader does not parse; a server holds locations alone")
        # Refused rather than keyed on its text: nginx tests regex locations in source order, and a
        # dict keyed by text calls two files carrying one set in two orders equal.
        # `scripts/checks/check_public_routes.py :: read_location` refuses one too.
        if child.args[:1] in (("~",), ("~*",)):
            raise NginxSyntax(
                f"{source}:{child.line}: the regex location `{' '.join(child.args)}`, whose match order this reader does not keep"
            )
        # An `@named` location is keyed on its text like any other: nginx reaches one by name from an
        # internal redirect, never by testing it against a URI in the order it stands.
        keyed(node, f"{LOCATION_PREFIX}{' '.join(child.args)}]", location_body(child, source), source, child.line)
    return node


def role(body: dict[str, Any], source: str, line: int) -> str:
    """Which server block this is.

    The two files' MAIN blocks agree on neither `listen` nor `server_name`, so a location's presence
    keys that one and the catch-all's own `server_name` keys the other.
    """
    if any(key.startswith(LOCATION_PREFIX) for key in body):
        return "main"
    if body.get("server_name") == CATCH_ALL_NAME:
        return "catch-all"
    written = body.get("server_name")
    if written is None:
        raise NginxSyntax(f"{source}:{line}: a server block declaring neither a location nor a server_name")
    # Sorted: nginx answers for the same set whichever order the names are written in, so a key
    # taking them as written renames the block on a swap and pairs it with nothing.
    return "redirect:" + " ".join(sorted(name for one in written for name in one))


def model(section: Section, source: str) -> dict[str, Any]:
    """One edge configuration as the tree the comparison walks."""
    node: dict[str, Any] = dict(directives(section, source))
    for block in section.blocks:
        if block.name not in BLOCKS:
            raise NginxSyntax(f"{source}:{block.line}: `{block.name}` opens a block this reader does not parse")
        if block.name == "location":
            raise NginxSyntax(f"{source}:{block.line}: a `location` outside any server block")
        if block.name == "server":
            body = server_body(block, source)
            keyed(node, f"server[{role(body, source, block.line)}]", body, source, block.line)
            continue
        if not block.args:
            raise NginxSyntax(f"{source}:{block.line}: `{block.name}` names no variable to set")
        entry = {"source": block.args[:-1], "arms": arms(block, source)}
        keyed(node, f"{block.name}[{block.args[-1]}]", entry, source, block.line)
    return node


def load(path: Path) -> dict[str, Any]:
    """One edge configuration, read as bytes so no platform's newline translation reaches a value."""
    tokens = tokenize(path.read_bytes().decode("utf-8"), path.name)
    if not tokens:
        raise NginxSyntax(f"{path.name}: no content to compare")
    section, index = parse_section(tokens, 0, path.name, top=True)
    if index != len(tokens):
        raise NginxSyntax(f"{path.name}:{tokens[index].line}: content this reader could not place")
    return model(section, path.name)


def repeated(value: Any) -> bool:
    """Whether a value is a directive's argument lists rather than a block or a marker."""
    return isinstance(value, tuple) and bool(value) and all(isinstance(one, tuple) for one in value)


def shown(value: Any) -> str:
    """A value as one line of a finding."""
    if isinstance(value, Marker):
        return value.text
    if isinstance(value, dict):
        return "a block: " + ", ".join(sorted(value))
    if repeated(value):
        return " ; ".join(" ".join(one) for one in value)
    if isinstance(value, tuple) and not value:
        return "no arguments"
    return repr(value)


def described(difference: Difference, prod_name: str, local_name: str) -> str:
    """Both sides of a difference, a directive written several times narrowed to what parts them.

    A whole `limit_req_zone` list printed in a finding leaves the reader diffing ten zones by eye
    for the one rate that moved.
    """
    prod, local = difference.prod, difference.local
    if repeated(prod) and repeated(local):
        only_prod = tuple(one for one in prod if one not in local)
        only_local = tuple(one for one in local if one not in prod)
        # A pure reorder leaves both sides empty, and then the whole list is what there is to show.
        if only_prod or only_local:
            prod_side = shown(only_prod) if only_prod else "nothing the other file lacks"
            local_side = shown(only_local) if only_local else "nothing the other file lacks"
            return f"{CONTINUATION}{prod_name} alone: {prod_side}\n{CONTINUATION}{local_name} alone: {local_side}"
    return f"{CONTINUATION}{prod_name}: {shown(prod)}\n{CONTINUATION}{local_name}: {shown(local)}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Does the local edge still mirror the production one?")
    parser.add_argument("--verbose", action="store_true", help="list the declared deltas as they are matched")
    parser.add_argument("files", nargs="*", metavar="FILE", help=f"the production and local files to compare (default: {PROD} {LOCAL})")
    args = parser.parse_args()

    if len(args.files) not in (0, 2):
        parser.error("give both files or neither")
    names: list[str] = args.files or [str(REPO_ROOT / PROD), str(REPO_ROOT / LOCAL)]
    prod_path, local_path = Path(names[0]), Path(names[1])

    try:
        prod, local = load(prod_path), load(local_path)
    except NginxSyntax as error:
        print(f"      {error}", file=sys.stderr)
        print("      Nothing was compared, so this is a refusal rather than a verdict on the files.", file=sys.stderr)
        print("      Teach scripts/checks/check_nginx_mirror.py :: model the construct, or revert it.", file=sys.stderr)
        return EXIT_REFUSED
    except (OSError, UnicodeDecodeError) as error:
        print(f"      {error}", file=sys.stderr)
        print("      Nothing was compared: both edge files have to be readable for the mirror to mean anything.", file=sys.stderr)
        # Input this checker cannot judge, which the kernel's contract calls EXIT_REFUSED.
        # EXIT_CRASH would claim the environment is broken and send a reader to the wrong repair.
        return EXIT_REFUSED

    judged = [(difference, declaring(difference, DECLARED_DELTAS)) for difference in diff(prod, local)]

    if args.verbose:
        for difference, delta in judged:
            if delta is not None:
                print(f"      declared  {difference.path} -- {delta.why}")

    findings = [
        Finding(
            "fail",
            f"{difference.path} differs, and no declared delta covers it\n{described(difference, prod_path.name, local_path.name)}",
        )
        for difference, delta in judged
        if delta is None
    ]
    # A delta covering nothing is the same rot pointed the other way, and only a check that fails
    # on it gets the claim removed.
    findings += uncovered(judged, DECLARED_DELTAS)

    code = report_findings(findings)
    if findings:
        print("\n      A difference outside the declared list is one the local stack cannot catch.")
        print("      Mirror the directive, or change nginx/local.conf's header and")
        print("      scripts/checks/check_nginx_mirror.py :: DECLARED_DELTAS together.")
        return code

    # The blocks both files hold: one file's alone is a difference the list declared, and counting
    # it here would report a comparison that never happened.
    blocks = [key for key in set(prod) & set(local) if key.startswith("server[")]
    print(f"      {len(blocks)} server block(s) compared, {len(DECLARED_DELTAS)} declared delta(s), nothing undeclared")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
