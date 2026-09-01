"""SCRIPTS · docker-compose.local.yml mirrors docker-compose.yml, except where it declares otherwise.

Both files parse either way, so nothing else holds the invariant. A construct outside the parsed
subset refuses rather than answering, and a declared delta matching no difference is a finding.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from checker_kernel import EXIT_REFUSED, REPO_ROOT, Finding, report_findings, run

PROD: Final = "docker-compose.yml"
LOCAL: Final = "docker-compose.local.yml"

# The column `checker_kernel.py :: report_findings` leaves after its `FAIL` tag, so a finding's second
# line lands under its first.
CONTINUATION: Final = " " * 14


class Marker:
    """A stand-in for a value that is not there, or for one this list does not pin."""

    def __init__(self, text: str) -> None:
        self.text = text

    def __repr__(self) -> str:
        return self.text


# `absent` is a value, not a missing entry: "the key is not in that file" is the commonest thing
# either side has to say.
ABSENT: Final = Marker("absent")
ANY: Final = Marker("whatever that file writes there")


@dataclass(frozen=True)
class Delta:
    """One difference `docker-compose.local.yml`'s header declares, at the grain it declares it."""

    path: str
    prod: Any
    local: Any
    why: str


# The local file's header list, in its order. Pinned wherever both files write the key, so a new
# nginx port or volume on one side is a finding rather than an allowed difference.
DECLARED_DELTAS: Final[tuple[Delta, ...]] = (
    Delta("services.frontend.build", ABSENT, ANY, "the local stack builds from source"),
    Delta("services.backend.build", ABSENT, ANY, "the local stack builds from source"),
    Delta("services.frontend.image", ANY, ABSENT, "production pulls a published image and never builds"),
    Delta("services.backend.image", ANY, ABSENT, "production pulls a published image and never builds"),
    Delta("services.frontend.environment", ABSENT, ANY, "the API_URL, AUTH_URL, LOG_FORMAT and MONGODB_URI overrides"),
    Delta("services.backend.environment", ABSENT, ANY, "the LOG_FORMAT and MONGODB_URI overrides"),
    Delta("services.mongo", ABSENT, ANY, "the local stack runs its own database; production's is a managed cluster"),
    Delta("services.frontend.depends_on", ABSENT, ANY, "only the local stack has a database to wait on"),
    Delta("services.backend.depends_on", ABSENT, ANY, "only the local stack has a database to wait on"),
    Delta("volumes", ABSENT, ANY, "the local database's storage; production keeps none on the host"),
    Delta("services.nginx.ports", ["80:80", "443:443"], ["3000:80"], "the local stack publishes one port on 3000"),
    Delta(
        "services.nginx.volumes",
        ["./nginx/prod.conf:/etc/nginx/conf.d/default.conf:ro", "./certs:/etc/nginx/certs:ro"],
        ["./nginx/local.conf:/etc/nginx/conf.d/default.conf:ro"],
        "the local proxy mounts local.conf and no certificates",
    ),
    Delta("services.frontend.deploy", ANY, ABSENT, "no resource limits locally"),
    Delta("services.backend.deploy", ANY, ABSENT, "no resource limits locally"),
    Delta("services.nginx.deploy", ANY, ABSENT, "no resource limits locally"),
)


# The one service either file may publish to the world. A delta covering a whole service covers its
# ports with it, so without this the wholesale `services.mongo` row would exempt a database from
# `docs/ops/spec.md :: I1` and nothing would notice.
EDGE_SERVICE: Final = "nginx"

# What binds this host alone. The IPv6 form is bracketed because that is how Docker spells an
# address in a port mapping, and an unbracketed `::1:` would match nothing it ever writes.
LOOPBACK_PREFIXES: Final = ("127.0.0.1:", "[::1]:")


class ComposeSyntax(Exception):
    """A construct outside the subset this reader parses, named with the line that carries it."""


@dataclass(frozen=True)
class Token:
    """One logical line: a flow sequence spanning several source lines arrives here as one."""

    indent: int
    text: str
    line: int


# A mapping key runs to the first colon a space or the line end follows, so `image: ghcr.io/x:latest`
# and the scalar `no-new-privileges:true` are told apart by the space rather than by position.
KEY_RE: Final = re.compile(r"^(?P<key>[^\s#][^:]*?):(?:[ \t]+(?P<value>.*\S))?$")


def strip_comment(raw: str) -> str:
    """The line with any trailing comment removed, quotes respected."""
    out: list[str] = []
    quote = ""
    for index, char in enumerate(raw):
        if quote:
            out.append(char)
            if char == quote:
                quote = ""
            continue
        if char in "\"'":
            quote = char
            out.append(char)
            continue
        if char == "#" and (index == 0 or raw[index - 1] in " \t"):
            break
        out.append(char)
    return "".join(out).rstrip()


def bracket_delta(text: str, where: str) -> int:
    """How far a line opens or closes a flow sequence, counting outside quotes only."""
    depth = 0
    quote = ""
    for char in text:
        if quote:
            if char == quote:
                quote = ""
            continue
        if char in "\"'":
            quote = char
        elif char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
        elif char in "{}":
            raise ComposeSyntax(f"{where}: a flow mapping, which this reader does not parse")
    return depth


def tokenize(text: str, source: str) -> list[Token]:
    """Logical lines, comments and blank lines dropped, flow sequences joined into one."""
    tokens: list[Token] = []
    pending = ""
    pending_indent = 0
    pending_line = 0
    depth = 0
    for number, raw in enumerate(text.split("\n"), start=1):
        where = f"{source}:{number}"
        if "\t" in raw:
            raise ComposeSyntax(f"{where}: a tab, which changes what the indentation means")
        content = strip_comment(raw)
        if not content.strip():
            continue
        # This reader's quote tracking does not honour an escape, so it refuses rather than
        # mis-reading the line.
        if "\\" in content:
            raise ComposeSyntax(f"{where}: a backslash escape, which this reader does not parse")
        stripped = content.strip()
        if pending:
            depth += bracket_delta(stripped, where)
            pending = f"{pending} {stripped}"
            if depth == 0:
                tokens.append(Token(pending_indent, pending, pending_line))
                pending = ""
            continue
        depth = bracket_delta(stripped, where)
        if depth < 0:
            raise ComposeSyntax(f"{where}: a flow sequence closes without opening")
        if depth > 0:
            pending, pending_indent, pending_line = stripped, len(content) - len(content.lstrip(" ")), number
            continue
        tokens.append(Token(len(content) - len(content.lstrip(" ")), stripped, number))
    if pending:
        raise ComposeSyntax(f"{source}:{pending_line}: a flow sequence that never closes")
    return tokens


def split_flow(text: str) -> list[str]:
    """A flow sequence's entries, split on the commas that are outside quotes."""
    parts: list[str] = []
    current: list[str] = []
    quote = ""
    for char in text:
        if quote:
            current.append(char)
            if char == quote:
                quote = ""
            continue
        if char in "\"'":
            quote = char
            current.append(char)
        elif char == ",":
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    parts.append("".join(current))
    return [part.strip() for part in parts if part.strip()]


def scalar(text: str) -> Any:
    """A written value as a comparable one: a flow sequence as a list, a quoted scalar unquoted."""
    text = text.strip()
    if text.startswith("[") and text.endswith("]"):
        return [scalar(part) for part in split_flow(text[1:-1])]
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return text[1:-1]
    return text


def parse_block(tokens: list[Token], index: int, anchors: dict[str, Any], source: str) -> tuple[Any, int]:
    """The mapping or sequence starting at `index`, and the index of the first token after it."""
    token = tokens[index]
    # A flow sequence written under its key, which is how the formatter leaves every
    # `healthcheck.test`. It is one node, so anything at its indent after it is malformed.
    if token.text.startswith("["):
        if index + 1 < len(tokens) and tokens[index + 1].indent >= token.indent:
            raise ComposeSyntax(f"{source}:{tokens[index + 1].line}: a second node beside a flow sequence")
        return scalar(token.text), index + 1
    if token.text == "-" or token.text.startswith("- "):
        return parse_sequence(tokens, index, token.indent, source)
    return parse_mapping(tokens, index, token.indent, anchors, source)


def parse_sequence(tokens: list[Token], index: int, indent: int, source: str) -> tuple[list[Any], int]:
    """A block sequence of scalars -- the only sequence shape either compose file writes."""
    items: list[Any] = []
    while index < len(tokens) and tokens[index].indent == indent and tokens[index].text.startswith("- "):
        token = tokens[index]
        entry = token.text[2:].strip()
        if not entry or KEY_RE.match(entry) or entry[0] in "&*":
            raise ComposeSyntax(f"{source}:{token.line}: a sequence entry that is not a plain scalar")
        items.append(scalar(entry))
        index += 1
        if index < len(tokens) and tokens[index].indent > indent:
            raise ComposeSyntax(f"{source}:{tokens[index].line}: a block under a sequence entry")
    if index < len(tokens) and tokens[index].indent == indent and tokens[index].text == "-":
        raise ComposeSyntax(f"{source}:{tokens[index].line}: a sequence entry with its value on the next line")
    return items, index


def parse_mapping(tokens: list[Token], index: int, indent: int, anchors: dict[str, Any], source: str) -> tuple[dict[str, Any], int]:
    """A block mapping, resolving an alias to the node its anchor named."""
    node: dict[str, Any] = {}
    while index < len(tokens) and tokens[index].indent == indent:
        token = tokens[index]
        match = KEY_RE.match(token.text)
        if match is None:
            raise ComposeSyntax(f"{source}:{token.line}: not a mapping key: {token.text!r}")
        key = match.group("key").strip()
        if key in node:
            raise ComposeSyntax(f"{source}:{token.line}: {key!r} is written twice in one mapping")
        value = match.group("value")
        index += 1
        nested = index < len(tokens) and tokens[index].indent > indent
        if value is None or value.startswith("&"):
            if not nested:
                raise ComposeSyntax(f"{source}:{token.line}: {key!r} has neither a value nor a block under it")
            child, index = parse_block(tokens, index, anchors, source)
            if value is not None:
                anchors[value[1:]] = child
            node[key] = child
            continue
        if nested:
            raise ComposeSyntax(f"{source}:{tokens[index].line}: a block under {key!r}, which already has a value")
        if value.startswith("*"):
            if value[1:] not in anchors:
                raise ComposeSyntax(f"{source}:{token.line}: the alias {value} names no anchor")
            node[key] = anchors[value[1:]]
        else:
            node[key] = scalar(value)
    if index < len(tokens) and tokens[index].indent > indent:
        raise ComposeSyntax(f"{source}:{tokens[index].line}: indented past its mapping without opening a block")
    return node, index


def load(path: Path) -> dict[str, Any]:
    """One compose file as nested dictionaries, lists and strings."""
    tokens = tokenize(path.read_text(encoding="utf-8"), path.name)
    if not tokens:
        raise ComposeSyntax(f"{path.name}: no content to compare")
    node, index = parse_block(tokens, 0, {}, path.name)
    if index != len(tokens):
        raise ComposeSyntax(f"{path.name}:{tokens[index].line}: content this reader could not place")
    if not isinstance(node, dict):
        raise ComposeSyntax(f"{path.name}: the document is a sequence, not a mapping of services")
    return node


@dataclass(frozen=True)
class Difference:
    """One place the two files disagree, described by what each side has there."""

    path: str
    prod: Any
    local: Any


def diff(prod: Any, local: Any, path: str = "") -> list[Difference]:
    """Every place the two documents disagree, reported at the deepest key they share."""
    if isinstance(prod, dict) and isinstance(local, dict):
        found: list[Difference] = []
        for key in sorted(set(prod) | set(local)):
            here = f"{path}.{key}" if path else key
            if key not in local:
                found.append(Difference(here, prod[key], ABSENT))
            elif key not in prod:
                found.append(Difference(here, ABSENT, local[key]))
            else:
                found.extend(diff(prod[key], local[key], here))
        return found
    if prod == local:
        return []
    return [Difference(path, prod, local)]


def side_matches(declared: Any, observed: Any) -> bool:
    """Whether one side of a difference is what the delta declares for it."""
    if declared is ANY:
        return observed is not ABSENT
    return declared == observed


def declaring(difference: Difference) -> Delta | None:
    """The delta that declares this difference, or None where none does."""
    for delta in DECLARED_DELTAS:
        if delta.path == difference.path and side_matches(delta.prod, difference.prod) and side_matches(delta.local, difference.local):
            return delta
    return None


def uncovered(judged: list[tuple[Difference, Delta | None]]) -> list[Finding]:
    """Every declared delta that matched no difference -- the allowlist rotting the other way."""
    # Identity, not equality: each row is its own object, so two rows spelling the same path cannot
    # mark one another matched.
    matched = {id(delta) for _, delta in judged if delta is not None}
    return [
        Finding(
            "fail",
            f"the declared delta {delta.path} ({delta.why}) covered nothing\n"
            f"{CONTINUATION}the files agree there, or the difference is no longer the one it pins",
        )
        for delta in DECLARED_DELTAS
        if id(delta) not in matched
    ]


def shown(value: Any) -> str:
    """A value as one line of a finding."""
    if isinstance(value, Marker):
        return value.text
    return repr(value)


def off_host_ports(document: dict[str, Any], name: str) -> list[Finding]:
    """Every way a service other than the edge becomes reachable from another host."""
    findings: list[Finding] = []
    for service, definition in sorted(document.get("services", {}).items()):
        if service == EDGE_SERVICE or not isinstance(definition, dict):
            continue

        # Host networking declares no `ports` at all and publishes every socket the service listens
        # on, so reading that key alone answers "nothing published" about the widest exposure there
        # is.
        if definition.get("network_mode") == "host":
            findings.append(
                Finding(
                    "fail",
                    f"{name}: {service} takes the host's own network, publishing everything it listens on\n"
                    f"{CONTINUATION}only {EDGE_SERVICE} is reachable off this host",
                )
            )

        published = definition.get("ports")
        if published is None:
            continue
        # Refused rather than skipped, as an unparsed construct is everywhere else here: a shape
        # this reader cannot judge is not a shape it may call safe.
        if not isinstance(published, list):
            findings.append(
                Finding(
                    "fail",
                    f"{name}: {service} writes `ports` as {published!r}, which this reader cannot judge\n"
                    f"{CONTINUATION}write it as a block sequence, one published port to an entry",
                )
            )
            continue

        for entry in published:
            if not str(entry).startswith(LOOPBACK_PREFIXES):
                findings.append(
                    Finding(
                        "fail",
                        f"{name}: {service} publishes {entry!r}, which binds every interface\n"
                        f"{CONTINUATION}only {EDGE_SERVICE} is reachable off this host; the rest bind 127.0.0.1",
                    )
                )
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Does the local compose file still mirror the production one?")
    parser.add_argument("--verbose", action="store_true", help="list the declared deltas as they are matched")
    parser.add_argument("files", nargs="*", metavar="FILE", help=f"the production and local files to compare (default: {PROD} {LOCAL})")
    args = parser.parse_args()

    if len(args.files) not in (0, 2):
        parser.error("give both files or neither")
    names: list[str] = args.files or [str(REPO_ROOT / PROD), str(REPO_ROOT / LOCAL)]
    prod_path, local_path = Path(names[0]), Path(names[1])

    try:
        prod, local = load(prod_path), load(local_path)
    except ComposeSyntax as error:
        print(f"      {error}", file=sys.stderr)
        print("      Nothing was compared, so this is a refusal rather than a verdict on the files.", file=sys.stderr)
        print("      Teach scripts/check_compose_mirror.py :: parse_block the construct, or revert it.", file=sys.stderr)
        return EXIT_REFUSED
    except OSError as error:
        print(f"      {error}", file=sys.stderr)
        print("      Nothing was compared: both compose files have to be readable for the mirror to mean anything.", file=sys.stderr)
        # A file the checker cannot open is input it cannot judge, which the kernel's contract calls
        # EXIT_REFUSED. EXIT_CRASH would claim the environment is broken, sending a reader to the
        # wrong repair.
        return EXIT_REFUSED

    judged = [(difference, declaring(difference)) for difference in diff(prod, local)]

    if args.verbose:
        for difference, delta in judged:
            if delta is not None:
                print(f"      declared  {difference.path} -- {delta.why}")

    escaped = off_host_ports(prod, prod_path.name) + off_host_ports(local, local_path.name)

    findings = escaped + [
        Finding(
            "fail",
            f"{difference.path} differs, and no declared delta covers it\n"
            f"{CONTINUATION}{prod_path.name}: {shown(difference.prod)}\n"
            f"{CONTINUATION}{local_path.name}: {shown(difference.local)}",
        )
        for difference, delta in judged
        if delta is None
    ]
    # A delta covering nothing is the same rot pointed the other way, and only a check that fails
    # on it gets the claim removed.
    findings += uncovered(judged)

    code = report_findings(findings)
    if escaped:
        print("\n      A published port is the setting a declared delta hides: one covering a whole")
        print("      service covers its ports with it, so nothing else here would see this.")
        print("      Bind it to 127.0.0.1, or route it through nginx (docs/ops/spec.md :: I1).")
    if len(findings) > len(escaped):
        print("\n      A difference outside the declared list is one the local stack cannot catch.")
        print("      Mirror the setting, or change docker-compose.local.yml's invariant list and")
        print("      scripts/check_compose_mirror.py :: DECLARED_DELTAS together.")
    if findings:
        return code

    services = sorted(set(prod.get("services", {})) | set(local.get("services", {})))
    print(f"      {len(services)} service(s) mirrored, {len(DECLARED_DELTAS)} declared delta(s), nothing undeclared, no port off this host")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
