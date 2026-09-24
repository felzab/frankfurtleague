"""SCRIPTS · what each stack exposes, and how its edge mounts its configuration, read off the model Compose renders.

`docker compose config` merges the files, applies the profiles and expands every short-syntax port
and volume into its long form, so this reads the model the engine is handed rather than parsing
YAML again. The gate writes the two models with `--format json --no-env-resolution` beside the
compose files it renders them from, and passes their paths.

Invariants:
- Production publishes nothing and declares exactly the services `PRODUCTION_SERVICES` names, so a
  database joining it is a finding (`docs/ops/spec.md :: I1`, `:: I174`).
- Locally only the edge publishes to every interface; the rest bind a loopback address (`:: I1`).
- Every mount the edge takes from `nginx/` is a directory, and production's are the pairs
  `scripts/ops/deploy.sh :: EDGE_CONFIG_DIRS` compares (`docs/ops/spec.md :: I355`).
- The edge opens its Control API at `scripts/ops/deploy.sh :: EDGE_CONTROL_SOCKET`, in a tmpfs of
  mode 700.
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


def local(model: dict[str, Any], name: str) -> list[Finding]:
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
        _, local_mounts = edge_mounts(local_model, "local", Path(args.local).resolve().parent, REPO_ROOT)
        findings += prod_mounts + local_mounts + compared(prod_pairs, deploy_pairs(DEPLOY), "production")
        socket = deploy_socket(DEPLOY)
        findings += control_socket(prod_model, "production", socket) + control_socket(local_model, "local", socket)
    except (*UNREADABLE, ValueError) as error:
        print(f"      {error}", file=sys.stderr)
        print("      Nothing was judged, so this is a refusal rather than a verdict on either stack.", file=sys.stderr)
        return EXIT_REFUSED
    code = report_findings(findings)
    if not findings:
        print(f"      production publishes nothing and runs {len(PRODUCTION_SERVICES)} services; locally only {EDGE_SERVICE} leaves loopback")
        print(f"      both edges mount {EDGE_CONFIG_ROOT}/ by directory, production's the pairs the deploy compares")
        print("      both edges open the Control API where the deploy asks it, in a tmpfs of mode 700")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
