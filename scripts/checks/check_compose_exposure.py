"""SCRIPTS · what each stack exposes, read off the model Compose itself renders.

`docker compose config` merges the files, applies the profiles and expands every short-syntax port
into its long form, so this reads the model the engine is handed rather than parsing YAML again.
The gate writes the two models with `--format json --no-env-resolution` and passes their paths.

Invariants:
- Production publishes nothing and declares exactly the services `PRODUCTION_SERVICES` names, so a
  database joining it is a finding (`docs/ops/spec.md :: I1`, `:: I174`).
- Locally only the edge publishes to every interface; the rest bind a loopback address (`:: I1`).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Final

# Every caller runs this as a script, so sys.path opens with THIS directory and `lib/` is a
# sibling of it rather than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import (  # noqa: E402 -- the insert above is what resolves it
    CONTINUATION,
    EXIT_REFUSED,
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Does either stack expose more than its edge?")
    parser.add_argument("production", metavar="PROD_JSON", help="docker compose -f docker-compose.yml config --format json")
    parser.add_argument("local", metavar="LOCAL_JSON", help="the same, with docker-compose.local.yml merged over it")
    args = parser.parse_args()
    try:
        prod_model = json.loads(Path(args.production).read_bytes())
        local_model = json.loads(Path(args.local).read_bytes())
        findings = production(prod_model, "production") + local(local_model, "local")
    except (*UNREADABLE, ValueError) as error:
        print(f"      {error}", file=sys.stderr)
        print("      Nothing was judged, so this is a refusal rather than a verdict on either stack.", file=sys.stderr)
        return EXIT_REFUSED
    code = report_findings(findings)
    if not findings:
        print(f"      production publishes nothing and runs {len(PRODUCTION_SERVICES)} services; locally only {EDGE_SERVICE} leaves loopback")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
