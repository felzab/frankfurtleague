"""SCRIPTS · the models Compose renders, against each stack's rules and the files that must agree.

`docker compose config` merges the files, applies the profiles, expands every short-syntax port and
volume and resolves each service's environment, so this reads the model the engine is handed rather
than parsing YAML again. Each rule states its invariant at its own function, beside the
`docs/ops/spec.md` row it holds.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Final

# Every caller runs this as a script, so sys.path opens with THIS directory and `lib/` is a
# sibling of it rather than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import (
    CONTINUATION,
    EXIT_REFUSED,
    REPO_ROOT,
    UNREADABLE,
    Finding,
    report_findings,
    run,
)

# Pinned rather than read off either file: a service joining production is a decision about what
# the server runs, and the one this pin exists for is a database (`docs/ops/spec.md :: I174`).
PRODUCTION_SERVICES: Final = frozenset({"frontend", "backend", "nginx", "cloudflared"})

EDGE_SERVICE: Final = "nginx"

# The long form's `host_ip` as Compose renders a loopback binding, IPv6 unbracketed.
LOOPBACK: Final = frozenset({"127.0.0.1", "::1"})

# The checkout directory whose mounts the deploy compares with what nginx loaded.
EDGE_CONFIG_ROOT: Final = "nginx"

DEPLOY: Final = REPO_ROOT / "scripts" / "ops" / "deploy.sh"

# The one service whose requests production's edge takes the visitor's address from.
CONNECTOR_SERVICE: Final = "cloudflared"

# Every service's networks, exactly: the connector shares one with nginx alone, and the application
# pair and the local database share the other with nginx (`docs/ops/spec.md :: I471`).
EDGE_NETWORK: Final = "frankfurtleague-net"
APP_NETWORK: Final = "frankfurtleague-app"
SERVICE_NETWORKS: Final = {
    CONNECTOR_SERVICE: frozenset({EDGE_NETWORK}),
    EDGE_SERVICE: frozenset({EDGE_NETWORK, APP_NETWORK}),
    "frontend": frozenset({APP_NETWORK}),
    "backend": frozenset({APP_NETWORK}),
    "mongo": frozenset({APP_NETWORK}),
}

# The actor token's signing key: the one service holding it, where that service's config reads it by
# default, and the checkout file the deploy's preflight judges (`docs/ops/spec.md :: I472`).
SIGNING_KEY: Final = "fl_actor_signing_key"
SIGNING_KEY_HOLDER: Final = "frontend"
SIGNING_KEY_TARGET: Final = f"/run/secrets/{SIGNING_KEY}"
SIGNING_KEY_FILE: Final = f"secrets/{SIGNING_KEY}"

# The header the visitor's address is taken from, and which element of it: Cloudflare's
# single-address header, the last element of a chain a client can prepend to (`nginx/shared/http.conf`).
REALIP_SETTINGS: Final = {"real_ip_header": "CF-Connecting-IP", "real_ip_recursive": "off"}


def services(model: dict[str, Any], name: str) -> dict[str, Any]:
    found = model.get("services")
    if not isinstance(found, dict):
        raise ValueError(f"{name}: no `services` mapping, so this is not a model `docker compose config` wrote")
    return found


def host_network(model: dict[str, Any], name: str) -> list[Finding]:
    """Host networking declares no port and publishes every socket, the widest exposure there is."""
    return [
        Finding("fail", f"{name}: {service} takes the host's own network, publishing everything it listens on")
        for service, definition in sorted(services(model, name).items())
        if definition.get("network_mode") == "host"
    ]


def production(model: dict[str, Any], name: str) -> list[Finding]:
    """Nothing published, and exactly `PRODUCTION_SERVICES`, so a database joining is a finding (`docs/ops/spec.md :: I1`, `:: I174`)."""
    declared = services(model, name)
    findings = host_network(model, name)
    if set(declared) != PRODUCTION_SERVICES:
        findings.append(
            Finding(
                "fail",
                f"{name} declares {sorted(declared)}, not {sorted(PRODUCTION_SERVICES)}\n"
                f"{CONTINUATION}production runs no database (I174); a new service is a change to PRODUCTION_SERVICES",
            )
        )
    findings += [
        Finding("fail", f"{name}: {service} publishes {definition['ports']!r}\n{CONTINUATION}production publishes nothing (I1)")
        for service, definition in sorted(declared.items())
        if definition.get("ports")
    ]
    return findings


def networks(model: dict[str, Any], name: str) -> list[Finding]:
    """Each service on exactly its `SERVICE_NETWORKS`, so no request reaches the application pair but through nginx.

    A service declaring none is rendered on `default`, which is a finding like any other network.
    """
    findings: list[Finding] = []
    for service, definition in sorted(services(model, name).items()):
        joined = definition.get("networks") or {}
        if not isinstance(joined, dict):
            raise ValueError(f"{name}: {service} has networks Compose did not render as a mapping, so this is not its rendered model")
        expected = SERVICE_NETWORKS.get(service)
        if expected is None:
            findings.append(
                Finding("fail", f"{name}: {service} is on no list of who joins which network\n{CONTINUATION}add it to SERVICE_NETWORKS (I471)")
            )
        elif frozenset(joined) != expected:
            findings.append(
                Finding(
                    "fail",
                    f"{name}: {service} joins {sorted(joined)}, not {sorted(expected)}\n"
                    f"{CONTINUATION}the connector reaches nginx alone, and the application reaches nothing but through nginx (I471)",
                )
            )
    return findings


def _declared_file(declared: object, project: Path) -> str:
    """A top-level secret's or config's `file`, relative to the rendered project where it sits inside it."""
    source_file = Path(str((declared.get("file") if isinstance(declared, dict) else None) or ""))
    return source_file.relative_to(project).as_posix() if source_file.is_relative_to(project) else source_file.as_posix()


def secrets_directory(model: dict[str, Any], name: str, project: Path) -> list[Finding]:
    """No bind mount and no config reaches into `SIGNING_KEY_FILE`'s directory, nor mounts one holding it.

    A secret is the one route a file there takes, so each reaches only the service naming it (I472).
    """
    directory = project / Path(SIGNING_KEY_FILE).parent
    findings: list[Finding] = []
    for service, definition in sorted(services(model, name).items()):
        for volume in definition.get("volumes") or []:
            if not isinstance(volume, dict):
                raise ValueError(f"{name}: {service} has a volume Compose did not expand, so this is not its rendered model")
            source = Path(str(volume.get("source")))
            if volume.get("type") == "bind" and (source.is_relative_to(directory) or directory.is_relative_to(source)):
                findings.append(
                    Finding(
                        "fail",
                        f"{name}: {service} bind-mounts {source} at {volume.get('target')}, which reaches {directory.name}/\n"
                        f"{CONTINUATION}a file there reaches a service as a Compose secret naming it, and no other way (I472)",
                    )
                )
    for config, declared in sorted((model.get("configs") or {}).items()):
        if (project / _declared_file(declared, project)).is_relative_to(directory):
            findings.append(Finding("fail", f"{name}: the config {config} is read from {directory.name}/, where only secrets are (I472)"))
    return findings


def signing_key(model: dict[str, Any], name: str, project: Path) -> list[Finding]:
    """The frontend alone holds the signing key, at `SIGNING_KEY_TARGET`, read from `SIGNING_KEY_FILE`.

    Any other holder mints actors the backend trusts, and another source is a file the preflight never read.
    """
    findings: list[Finding] = []
    holders: list[str] = []
    declared_secrets = model.get("secrets") or {}
    # A second secret name reading the file is the key under an alias, which a check on the name passes by.
    key_names = {SIGNING_KEY} | {
        secret for secret, declared in declared_secrets.items() if _declared_file(declared, project) == SIGNING_KEY_FILE
    }
    for alias in sorted(key_names - {SIGNING_KEY}):
        findings.append(Finding("fail", f"{name}: the secret {alias} is read from {SIGNING_KEY_FILE}, which only {SIGNING_KEY} may be (I472)"))
    for service, definition in sorted(services(model, name).items()):
        for entry in definition.get("secrets") or []:
            source = entry.get("source") if isinstance(entry, dict) else entry
            if source not in key_names:
                continue
            holders.append(service)
            target = str((entry.get("target") if isinstance(entry, dict) else None) or source)
            # A relative target is a name under `/run/secrets` (https://docs.docker.com/reference/compose-file/services/#secrets).
            mounted = target if target.startswith("/") else f"/run/secrets/{target}"
            if mounted != SIGNING_KEY_TARGET:
                findings.append(Finding("fail", f"{name}: {service} mounts {SIGNING_KEY} at {mounted}, not {SIGNING_KEY_TARGET} (I472)"))
    if holders != [SIGNING_KEY_HOLDER]:
        findings.append(Finding("fail", f"{name}: {holders or 'nothing'} holds {SIGNING_KEY}, not {SIGNING_KEY_HOLDER} alone (I472)"))
    read = _declared_file(declared_secrets.get(SIGNING_KEY), project)
    if read != SIGNING_KEY_FILE:
        findings.append(Finding("fail", f"{name}: {SIGNING_KEY} is read from {read!r}, not {SIGNING_KEY_FILE} (I472)"))
    return findings


def local(model: dict[str, Any], name: str) -> list[Finding]:
    """Only the edge publishes to every interface; the rest bind a loopback address (`docs/ops/spec.md :: I1`)."""
    findings = host_network(model, name)
    for service, definition in sorted(services(model, name).items()):
        if service == EDGE_SERVICE:
            continue
        for port in definition.get("ports") or []:
            if not isinstance(port, dict):
                raise ValueError(f"{name}: {service} has a port Compose did not expand, so this is not its rendered model")
            if port.get("host_ip") not in LOOPBACK:
                where = port.get("host_ip") or "every interface"
                findings.append(
                    Finding(
                        "fail",
                        f"{name}: {service} publishes {port.get('published')}->{port.get('target')} on {where}\n"
                        f"{CONTINUATION}only {EDGE_SERVICE} is reachable off this host; the rest bind 127.0.0.1 (I1)",
                    )
                )
    return findings


def edge_mounts(model: dict[str, Any], name: str, project: Path, checkout: Path) -> tuple[list[tuple[str, str]], list[Finding]]:
    """The edge's `nginx/` mounts as (checkout path, container path), and a finding for each file mount.

    A file mount keeps the inode a pull replaces, so a reload re-reads the old file (I355).
    """
    edge = services(model, name).get(EDGE_SERVICE)
    if not isinstance(edge, dict):
        raise ValueError(f"{name}: no {EDGE_SERVICE} service, so no edge mount was read")
    pairs: list[tuple[str, str]] = []
    findings: list[Finding] = []
    for volume in edge.get("volumes") or []:
        if not isinstance(volume, dict):
            raise ValueError(f"{name}: {EDGE_SERVICE} has a volume Compose did not expand, so this is not its rendered model")
        if volume.get("type") != "bind":
            continue
        source = Path(str(volume.get("source")))
        # Resolved against the directory the model was rendered beside, where Compose resolved it.
        if not source.is_relative_to(project):
            continue
        relative = source.relative_to(project).as_posix()
        if relative.split("/", 1)[0] != EDGE_CONFIG_ROOT:
            continue
        pairs.append((relative, str(volume.get("target"))))
        if not (checkout / relative).is_dir():
            findings.append(
                Finding(
                    "fail",
                    f"{name}: {EDGE_SERVICE} mounts {relative} at {volume.get('target')}, which is not a directory\n"
                    f"{CONTINUATION}a file mount keeps the file a pull replaced, and a reload re-reads it (I355)",
                )
            )
    if not pairs:
        findings.append(
            Finding("fail", f"{name}: {EDGE_SERVICE} mounts nothing from {EDGE_CONFIG_ROOT}/, so it serves none of this checkout's edge")
        )
    return pairs, findings


def deploy_pairs(deploy: Path) -> list[tuple[str, str]]:
    """`EDGE_CONFIG_DIRS` as the deploy script assigns it, on one line."""
    found = re.search(r"^EDGE_CONFIG_DIRS=\((.*)\)$", deploy.read_bytes().decode(), re.MULTILINE)
    if found is None:
        raise ValueError(f"{deploy.name} assigns no EDGE_CONFIG_DIRS array on one line, so no pair was compared")
    return [(source, target) for source, target in re.findall(r'"([^":]+):([^"]+)"', found.group(1))]


def compared(pairs: list[tuple[str, str]], compared_pairs: list[tuple[str, str]], name: str) -> list[Finding]:
    """A mount the deploy does not compare is configuration nginx loads unchecked, and a pair nothing mounts fails every deploy."""
    if sorted(pairs) == sorted(compared_pairs):
        return []
    return [
        Finding(
            "fail",
            f"{name}: {EDGE_SERVICE} mounts {sorted(pairs)}, and scripts/ops/deploy.sh :: EDGE_CONFIG_DIRS compares {sorted(compared_pairs)}\n"
            f"{CONTINUATION}the two move together (I355)",
        )
    ]


def deploy_socket(deploy: Path) -> str:
    """`EDGE_CONTROL_SOCKET` as the deploy script assigns it."""
    found = re.search(r'^EDGE_CONTROL_SOCKET="([^"]+)"$', deploy.read_bytes().decode(), re.MULTILINE)
    if found is None:
        raise ValueError(f"{deploy.name} assigns no EDGE_CONTROL_SOCKET, so the edge's control socket was not compared")
    return found.group(1)


def control_socket(model: dict[str, Any], name: str, socket: str) -> list[Finding]:
    """The edge opens its Control API where the deploy asks it, in a tmpfs only root can enter.

    Any other socket refuses every reload; Docker's default mode lets the worker's user in.
    """
    edge = services(model, name).get(EDGE_SERVICE) or {}
    command = [str(argument) for argument in edge.get("command") or []]
    listens = [command[i + 1] for i, argument in enumerate(command[:-1]) if argument == "-l"]
    findings: list[Finding] = []
    if listens != [f"unix:{socket}"]:
        findings.append(
            Finding(
                "fail",
                f"{name}: {EDGE_SERVICE}'s command opens its Control API at {listens or 'nothing'}, and the deploy asks unix:{socket}\n"
                f"{CONTINUATION}scripts/ops/deploy.sh :: EDGE_CONTROL_SOCKET and the command move together",
            )
        )
    tmpfs = edge.get("tmpfs") or []
    directory = socket.rsplit("/", 1)[0]
    if f"{directory}:mode=700" not in ([tmpfs] if isinstance(tmpfs, str) else tmpfs):
        findings.append(
            Finding(
                "fail",
                f"{name}: {EDGE_SERVICE} mounts no tmpfs at {directory} with mode=700, among {tmpfs!r}\n"
                f"{CONTINUATION}a socket left on disk refuses the next start, and any other mode lets the worker's user reload nginx",
            )
        )
    return findings


def connector_address(model: dict[str, Any], name: str) -> str:
    """The one static address the rendered model gives the connector."""
    connector = services(model, name).get(CONNECTOR_SERVICE)
    networks = connector.get("networks") if isinstance(connector, dict) else None
    addresses = [n.get("ipv4_address") for n in networks.values() if isinstance(n, dict)] if isinstance(networks, dict) else []
    addresses = [address for address in addresses if address]
    if len(addresses) != 1:
        raise ValueError(
            f"{name}: {CONNECTOR_SERVICE} has {len(addresses)} static addresses, not one, so the edge's trust in it was not compared"
        )
    return str(addresses[0])


def edge_configuration(pairs: list[tuple[str, str]], checkout: Path) -> str:
    """Every file in the checkout directories an edge mounts, joined.

    Read whole: a server or a location may hold realip directives too, and its own replace the
    ones inherited from http level (nginx's `ngx_http_realip_merge_loc_conf`).
    """
    directories = [checkout / source for source, _ in sorted(pairs) if (checkout / source).is_dir()]
    return "\n".join(file.read_bytes().decode() for directory in directories for file in sorted(directory.iterdir()) if file.is_file())


def statements(conf: str) -> list[tuple[str, list[str]]]:
    """nginx's statements in order, each with its words, comments dropped and quotes respected.

    Never by line: nginx takes a whole `location { … }` on one line, where a line-anchored pattern
    sees nothing.
    """
    found: list[tuple[str, list[str]]] = []
    words: list[str] = []
    word = ""
    quote = ""
    index = 0
    while index < len(conf):
        char = conf[index]
        if quote:
            word += char
            if char == "\\" and index + 1 < len(conf):
                word += conf[index + 1]
                index += 1
            elif char == quote:
                quote = ""
        elif char in "\"'":
            quote = char
            word += char
        elif char == "#":
            newline = conf.find("\n", index)
            index = len(conf) if newline < 0 else newline
            continue
        elif char in ";{}" or char.isspace():
            if word:
                words.append(word)
                word = ""
            if not char.isspace():
                found.append(({";": "statement", "{": "open", "}": "close"}[char], words))
                words = []
        else:
            word += char
        index += 1
    return found


def geo_arms(parsed: list[tuple[str, list[str]]], variable: str) -> tuple[int, list[tuple[str, ...]]]:
    """How many `geo` blocks set `variable`, and every arm they hold."""
    blocks = 0
    arms: list[tuple[str, ...]] = []
    depth = 0
    for kind, words in parsed:
        if depth:
            depth += {"open": 1, "close": -1}.get(kind, 0)
            if depth == 1 and kind == "statement" and words:
                arms.append(tuple(words))
        elif kind == "open" and words == ["geo", variable]:
            blocks += 1
            depth = 1
    return blocks, arms


def trusted_connector(conf: str, address: str, name: str) -> list[Finding]:
    """`set_real_ip_from` and the geo arm marking the fallback each name the connector's address, and nothing else.

    Another address leaves every visitor keyed to the connector's; a wider one lets any host on it name a visitor.
    """
    parsed = statements(conf)
    declared: dict[str, list[str]] = {}
    for kind, words in parsed:
        if kind == "statement" and len(words) >= 2:
            declared.setdefault(words[0], []).append(" ".join(words[1:]))
    trusted = declared.get("set_real_ip_from", [])
    blocks, marked = geo_arms(parsed, "$realip_fallback")
    if not blocks:
        raise ValueError(f"{name} declares no `geo $realip_fallback` block, so the fallback's marker was not compared")
    arms = [arm for arm in marked if arm[0] != "default"]
    findings: list[Finding] = []
    if trusted != [address]:
        findings.append(
            Finding(
                "fail",
                f"{name} trusts {trusted or 'nothing'} with set_real_ip_from, and the connector is {address}\n"
                f"{CONTINUATION}the edge takes a visitor's address from the connector alone (I18)",
            )
        )
    if arms != [(f"{address}/32", "1")]:
        findings.append(
            Finding(
                "fail",
                f"{name} marks {arms or 'nothing'} as the realip fallback, and the connector is {address}/32\n"
                f"{CONTINUATION}the marker and set_real_ip_from name one address (I18)",
            )
        )
    for directive, expected in REALIP_SETTINGS.items():
        values = declared.get(directive, [])
        if values != [expected]:
            findings.append(
                Finding(
                    "fail",
                    f"{name} declares {directive} {values or 'nowhere'}, not once as {expected}\n"
                    f"{CONTINUATION}a second one, in a server or a location, replaces the shared one there (I18)",
                )
            )
    return findings


# Each application service's environment files, in order, relative to the checkout: its package's
# file, then the root's, which holds the names the two must hold equal (`docs/ops/spec.md :: I429`).
ENV_FILES: Final = {"frontend": ("fl_frontend/.env", ".env"), "backend": ("fl_backend/.env", ".env")}
# The names the gate's stand-in environment files carry, each valued with that file's path: a
# `STAND_IN_READ` name of each file's own, and `STAND_IN_LAST`, which every stand-in sets.
STAND_IN_READ: Final = "FL_STAND_IN_READ_"
STAND_IN_LAST: Final = "FL_STAND_IN_LAST"


def env_files(model: dict[str, Any], name: str) -> list[Finding]:
    """Each service reads its package's file, then the checkout root's, and no other.

    `scripts/ops/deploy.sh :: ENV_UNION_BUILD` joins exactly that pair, so any other list passes the
    preflight and meets the boot gate after the recreate.
    """
    findings: list[Finding] = []
    declared = services(model, name)
    for service, expected in ENV_FILES.items():
        # Never the rendered `env_file`: Compose 2.38's `config` drops it even under
        # `--no-env-resolution`, and later releases keep it unresolved, so only what the stand-ins
        # resolved to reads the same on both.
        environment = (declared.get(service) or {}).get("environment") or {}
        if not isinstance(environment, dict):
            raise ValueError(f"{name}: {service} has an environment Compose did not render as a mapping, so this is not its rendered model")
        read = sorted(str(value) for key, value in environment.items() if key.startswith(STAND_IN_READ))
        last = environment.get(STAND_IN_LAST)
        # Exactly the two, the root's read last: with two, that is the order, the last file read winning.
        if read != sorted(expected) or last != expected[-1]:
            findings.append(
                Finding(
                    "fail",
                    f"{name}: {service} reads the environment files {read}, {last} last, not {list(expected)} in that order\n"
                    f"{CONTINUATION}the deploy judges the package's file joined to the checkout's, in that order (I429)",
                )
            )
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Does either stack expose more than its edge, or mount the edge's configuration by file?")
    parser.add_argument("production", metavar="PROD_JSON", help="docker compose -f docker-compose.yml config --format json")
    parser.add_argument("local", metavar="LOCAL_JSON", help="the same, with docker-compose.local.yml merged over it")
    args = parser.parse_args()
    try:
        prod_model = json.loads(Path(args.production).read_bytes())
        local_model = json.loads(Path(args.local).read_bytes())
        findings = production(prod_model, "production") + local(local_model, "local")
        prod_pairs, prod_mounts = edge_mounts(prod_model, "production", Path(args.production).resolve().parent, REPO_ROOT)
        local_pairs, local_mounts = edge_mounts(local_model, "local", Path(args.local).resolve().parent, REPO_ROOT)
        findings += prod_mounts + local_mounts + compared(prod_pairs, deploy_pairs(DEPLOY), "production")
        findings += env_files(prod_model, "production") + env_files(local_model, "local")
        findings += networks(prod_model, "production") + networks(local_model, "local")
        findings += signing_key(prod_model, "production", Path(args.production).resolve().parent)
        findings += signing_key(local_model, "local", Path(args.local).resolve().parent)
        findings += secrets_directory(prod_model, "production", Path(args.production).resolve().parent)
        findings += secrets_directory(local_model, "local", Path(args.local).resolve().parent)
        socket = deploy_socket(DEPLOY)
        findings += control_socket(prod_model, "production", socket) + control_socket(local_model, "local", socket)
        # Production's address for both: the local stack starts no connector, and an edge trusting
        # what the other does not is serving another edge's configuration.
        connector = connector_address(prod_model, "production")
        for pairs, name in ((prod_pairs, "production's edge"), (local_pairs, "the local edge")):
            findings += trusted_connector(edge_configuration(pairs, REPO_ROOT), connector, name)
    except (*UNREADABLE, ValueError) as error:
        print(f"      {error}", file=sys.stderr)
        print("      Nothing was judged, so this is a refusal rather than a verdict on either stack.", file=sys.stderr)
        return EXIT_REFUSED
    code = report_findings(findings)
    if not findings:
        print(f"      production publishes nothing and runs {len(PRODUCTION_SERVICES)} services; locally only {EDGE_SERVICE} leaves loopback")
        print(f"      both edges mount {EDGE_CONFIG_ROOT}/ by directory, production's the pairs the deploy compares")
        print("      both edges open the Control API where the deploy asks it, in a tmpfs of mode 700")
        print(f"      either edge trusts the {CONNECTOR_SERVICE} address alone, and marks it as the fallback")
        print("      each application service reads its package's environment file, then the checkout's")
        print(f"      the connector shares a network with {EDGE_SERVICE} alone, and the application pair with {EDGE_SERVICE} alone")
        print(f"      {SIGNING_KEY_HOLDER} alone holds the actor token's signing key, read from {SIGNING_KEY_FILE}")
        print(f"      no service mounts {Path(SIGNING_KEY_FILE).parent.as_posix()}/ but through a secret naming its file")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
