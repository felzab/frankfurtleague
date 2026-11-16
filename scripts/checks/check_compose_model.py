"""The models Compose renders, against each stack's rules and the files that must agree.

`docker compose config` merges the files, applies the profiles, expands every short-syntax port and
volume and resolves each service's environment, so this reads the model the engine is handed rather
than parsing YAML again.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final
from urllib.parse import urlsplit

# Run by hand, a script's sys.path opens with its own directory, and `lib/` is a sibling of it rather
# than in it.
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
from nginx_conf import NginxSyntax, parse, walk

# Pinned rather than read off either file: a service joining production is a decision about what
# the server runs, and the one this pin exists for is a database.
PRODUCTION_SERVICES: Final = frozenset({"frontend", "backend", "nginx", "cloudflared"})

EDGE_SERVICE: Final = "nginx"

# The long form's `host_ip` as Compose renders a loopback binding, IPv6 unbracketed.
LOOPBACK: Final = frozenset({"127.0.0.1", "::1"})

EDGE_CONFIG_ROOT: Final = "nginx"

# The one service whose requests production's edge takes the visitor's address from.
CONNECTOR_SERVICE: Final = "cloudflared"

# Every service's networks, exactly: the connector shares one with nginx alone, and the application
# pair and the local database share the other with nginx.
EDGE_NETWORK: Final = "frankfurtleague-net"
APP_NETWORK: Final = "frankfurtleague-app"
SERVICE_NETWORKS: Final = {
    CONNECTOR_SERVICE: frozenset({EDGE_NETWORK}),
    EDGE_SERVICE: frozenset({EDGE_NETWORK, APP_NETWORK}),
    "frontend": frozenset({APP_NETWORK}),
    "backend": frozenset({APP_NETWORK}),
    "mongo": frozenset({APP_NETWORK}),
}

# The checkout directory every credential file sits in, reached by nothing but a secret naming its file.
SECRETS_PATH: Final = "secrets"
# Where a service reads each file a secret or a config hands it, the frontend's `DEFAULT_SECRETS_DIR`.
RUN_SECRETS: Final = "/run/secrets"
# The local stack's database service, the one host its logins may name.
LOCAL_DATABASE_SERVICE: Final = "mongo"

_FRONTEND: Final = frozenset({"frontend"})
_BACKEND: Final = frozenset({"backend"})
# The three internal keys: one file each, read by both services.
_BOTH: Final = frozenset({"frontend", "backend"})
_EITHER_STACK: Final = {
    "auth_secret": _FRONTEND,
    "internal_api_key_base": _BOTH,
    "internal_api_key_system": _BOTH,
    "internal_api_key_admin": _BOTH,
}

# Every secret each stack declares, as (its holders, the checkout file it is read from): a holder that
# does not read it is one more place it leaks from, and a reader lacking it refuses its boot.
SECRET_HOLDERS: Final[dict[str, dict[str, tuple[frozenset[str], str]]]] = {
    "production": {
        **{secret: (holders, f"{SECRETS_PATH}/{secret}") for secret, holders in _EITHER_STACK.items()},
        "tunnel_token": (frozenset({"cloudflared"}), f"{SECRETS_PATH}/tunnel_token"),
        "auth_resend_key": (_FRONTEND, f"{SECRETS_PATH}/auth_resend_key"),
        "resend_webhook_secret": (_FRONTEND, f"{SECRETS_PATH}/resend_webhook_secret"),
        "betterstack_heartbeat_url": (_FRONTEND, f"{SECRETS_PATH}/betterstack_heartbeat_url"),
        "turnstile_secret_key": (_FRONTEND, f"{SECRETS_PATH}/turnstile_secret_key"),
        "frontend_mongodb_uri": (_FRONTEND, f"{SECRETS_PATH}/frontend_mongodb_uri"),
        "backend_mongodb_uri": (_BACKEND, f"{SECRETS_PATH}/backend_mongodb_uri"),
    },
    # No connector, no mail and no provider event; both logins are inline configs `local_logins` judges.
    "local": {secret: (holders, f"{SECRETS_PATH}/{secret}") for secret, holders in _EITHER_STACK.items()},
}

# The environment names those files replace: one in a service's `environment:` is a second copy of a
# credential beside its file.
MOVED_ENV_NAMES: Final = frozenset(
    {
        "MONGODB_URI",
        "AUTH_SECRET",
        "AUTH_RESEND_KEY",
        "RESEND_WEBHOOK_SECRET",
        "INTERNAL_API_KEY_BASE",
        "INTERNAL_API_KEY_SYSTEM",
        "INTERNAL_API_KEY_ADMIN",
        "TURNSTILE_SECRET_KEY",
        "BETTERSTACK_HEARTBEAT_URL",
    }
)

# The header the edge takes the visitor's address from: Cloudflare's single-address header.
REALIP_SETTINGS: Final = {"real_ip_header": "CF-Connecting-IP"}


def services(model: dict[str, Any], name: str) -> dict[str, Any]:
    found = model.get("services")
    if not isinstance(found, dict):
        raise ValueError(f"{name}: no `services` mapping, so this is not a model `docker compose config` wrote")
    return found


def host_network(model: dict[str, Any], name: str) -> list[Finding]:
    """Host networking declares no port and publishes every socket, the widest exposure there is."""
    return [
        Finding(f"{name}: {service} takes the host's own network, publishing everything it listens on")
        for service, definition in sorted(services(model, name).items())
        if definition.get("network_mode") == "host"
    ]


def production(model: dict[str, Any], name: str) -> list[Finding]:
    """Nothing published, and exactly `PRODUCTION_SERVICES`, so a database joining is a finding."""
    declared = services(model, name)
    findings = host_network(model, name)
    if set(declared) != PRODUCTION_SERVICES:
        findings.append(
            Finding(
                f"{name} declares {sorted(declared)}, not {sorted(PRODUCTION_SERVICES)}\n"
                f"{CONTINUATION}production runs no database; a new service is a change to PRODUCTION_SERVICES",
            )
        )
    findings += [
        Finding(f"{name}: {service} publishes {definition['ports']!r}\n{CONTINUATION}production publishes nothing")
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
            findings.append(Finding(f"{name}: {service} is on no list of who joins which network\n{CONTINUATION}add it to SERVICE_NETWORKS"))
        elif frozenset(joined) != expected:
            findings.append(
                Finding(
                    f"{name}: {service} joins {sorted(joined)}, not {sorted(expected)}\n"
                    f"{CONTINUATION}the connector reaches nginx alone, and the application reaches nothing but through nginx",
                )
            )
    return findings


# What each service adds back after dropping every capability: nginx's master fails to start without
# each of its three, and every other service runs as its own user.
CAPABILITIES_ADDED: Final = {EDGE_SERVICE: frozenset({"CHOWN", "SETUID", "SETGID"})}
# The spellings Compose documents for the option, a boolean one taking either separator or none.
NO_NEW_PRIVILEGES: Final = frozenset({"no-new-privileges", "no-new-privileges:true", "no-new-privileges=true"})


def _capabilities(listed: list[Any] | None) -> frozenset[str]:
    """Capability names as the kernel's list spells them, a `CAP_` prefix Docker also accepts dropped."""
    return frozenset(str(name).upper().removeprefix("CAP_") for name in listed or [])


def privileges(model: dict[str, Any], name: str) -> list[Finding]:
    """Every service drops every capability, takes `no-new-privileges`, and adds back only `CAPABILITIES_ADDED`'s.

    One left in place is one no start was shown to need, and NET_RAW reads the bridge a token crosses.
    """
    findings: list[Finding] = []
    for service, definition in sorted(services(model, name).items()):
        dropped = _capabilities(definition.get("cap_drop"))
        added = _capabilities(definition.get("cap_add"))
        allowed = CAPABILITIES_ADDED.get(service, frozenset())
        if dropped != {"ALL"}:
            findings.append(Finding(f"{name}: {service} drops {sorted(dropped) or 'nothing'}, not ALL"))
        if added != allowed:
            findings.append(Finding(f"{name}: {service} adds back {sorted(added) or 'nothing'}, not {sorted(allowed) or 'nothing'}"))
        if not NO_NEW_PRIVILEGES & set(definition.get("security_opt") or []):
            findings.append(Finding(f"{name}: {service} does not set no-new-privileges"))
    return findings


def _declared_file(declared: object, project: Path) -> str:
    """A top-level secret's or config's `file`, relative to the rendered project where it sits inside it."""
    source_file = Path(str((declared.get("file") if isinstance(declared, dict) else None) or ""))
    return source_file.relative_to(project).as_posix() if source_file.is_relative_to(project) else source_file.as_posix()


def secrets_directory(model: dict[str, Any], name: str, project: Path) -> list[Finding]:
    """No bind mount and no config reaches into `SECRETS_PATH`, nor mounts one holding it.

    A secret is the one route a file there takes, so each reaches only the service naming it.
    """
    directory = project / SECRETS_PATH
    findings: list[Finding] = []
    for service, definition in sorted(services(model, name).items()):
        for volume in definition.get("volumes") or []:
            if not isinstance(volume, dict):
                raise ValueError(f"{name}: {service} has a volume Compose did not expand, so this is not its rendered model")
            source = Path(str(volume.get("source")))
            if volume.get("type") == "bind" and (source.is_relative_to(directory) or directory.is_relative_to(source)):
                findings.append(
                    Finding(
                        f"{name}: {service} bind-mounts {source} at {volume.get('target')}, which reaches {directory.name}/\n"
                        f"{CONTINUATION}a file there reaches a service as a Compose secret naming it, and no other way",
                    )
                )
    for config, declared in sorted((model.get("configs") or {}).items()):
        if (project / _declared_file(declared, project)).is_relative_to(directory):
            findings.append(Finding(f"{name}: the config {config} is read from {directory.name}/, where only secrets are"))
    return findings


def secret_holders(model: dict[str, Any], name: str, project: Path, stack: str) -> list[Finding]:
    """Exactly `SECRET_HOLDERS[stack]`: each declared, read from its file, and held by its services alone at `/run/secrets/<name>`.

    A second name reading one file is that credential under an alias, so an undeclared name is a finding too.
    """
    expected = SECRET_HOLDERS[stack]
    declared = model.get("secrets") or {}
    findings: list[Finding] = []
    for secret in sorted(set(declared) - set(expected)):
        findings.append(Finding(f"{name}: the secret {secret} is declared and SECRET_HOLDERS lists no such secret"))
    held: dict[str, list[str]] = {secret: [] for secret in expected}
    for service, definition in sorted(services(model, name).items()):
        for entry in definition.get("secrets") or []:
            source = str(entry.get("source") if isinstance(entry, dict) else entry)
            if source not in held:
                continue
            held[source].append(service)
            target = str((entry.get("target") if isinstance(entry, dict) else None) or source)
            # Compose reads a relative target as a name under `/run/secrets`.
            mounted = target if target.startswith("/") else f"{RUN_SECRETS}/{target}"
            if mounted != f"{RUN_SECRETS}/{source}":
                findings.append(Finding(f"{name}: {service} mounts {source} at {mounted}, not {RUN_SECRETS}/{source}"))
    for secret, (holders, source_file) in sorted(expected.items()):
        if secret not in declared:
            findings.append(Finding(f"{name}: the secret {secret} is not declared, and {sorted(holders)} read it"))
            continue
        read = _declared_file(declared[secret], project)
        if read != source_file:
            findings.append(Finding(f"{name}: {secret} is read from {read!r}, not {source_file}"))
        if sorted(held[secret]) != sorted(holders):
            findings.append(Finding(f"{name}: {held[secret] or 'nothing'} holds {secret}, not {sorted(holders)}"))
    return findings


def _not_the_local_database(content: object, services_declared: dict[str, Any]) -> str | None:
    """Why `content` is not a login-free `mongodb://` URI naming `LOCAL_DATABASE_SERVICE` alone, or None where it is."""
    parts = urlsplit(content.strip()) if isinstance(content, str) else None
    if parts is None or parts.scheme != "mongodb":
        return "holds no inline mongodb:// URI"
    login, _, hosts = parts.netloc.rpartition("@")
    # A login would sit in a tracked file, and the stack's database asks for none.
    if login:
        return "carries a login"
    named = [host.rsplit(":", 1)[0] for host in hosts.split(",")]
    if named != [LOCAL_DATABASE_SERVICE] or LOCAL_DATABASE_SERVICE not in services_declared:
        return f"names {named}, not the stack's own {LOCAL_DATABASE_SERVICE} service"
    return None


def local_logins(model: dict[str, Any], name: str) -> list[Finding]:
    """Every config a service mounts at `RUN_SECRETS` is a login-free URI naming the stack's own database.

    A service reads any file there as a credential, and a config sits in a tracked compose file: a login there is
    published, and any other host aims the stack at a database it does not start. Production starts none, so a
    config there is a finding whatever it holds.
    """
    declared = model.get("configs") or {}
    services_declared = services(model, name)
    findings: list[Finding] = []
    for service, definition in sorted(services_declared.items()):
        for entry in definition.get("configs") or []:
            if not isinstance(entry, dict):
                raise ValueError(f"{name}: {service} has a config Compose did not expand, so this is not its rendered model")
            source = str(entry.get("source"))
            # Compose mounts a config with no target at `/<source>`.
            target = str(entry.get("target") or f"/{source}")
            if target.rpartition("/")[0] != RUN_SECRETS:
                continue
            if (wrong := _not_the_local_database((declared.get(source) or {}).get("content"), services_declared)) is not None:
                findings.append(
                    Finding(
                        f"{name}: the config {source}, which {service} reads at {target}, {wrong}\n"
                        f"{CONTINUATION}a login there aims the stack at a database other than its own",
                    )
                )
    return findings


def moved_names(model: dict[str, Any], name: str) -> list[Finding]:
    """No service is handed a name in `MOVED_ENV_NAMES` through `environment:`, in any letter case.

    The backend folds case, so a lower-cased copy is the same credential again.
    """
    findings: list[Finding] = []
    for service, definition in sorted(services(model, name).items()):
        environment = definition.get("environment") or {}
        if not isinstance(environment, dict):
            raise ValueError(f"{name}: {service} has an environment Compose did not render as a mapping, so this is not its rendered model")
        for variable in sorted(environment):
            if str(variable).upper() in MOVED_ENV_NAMES:
                findings.append(
                    Finding(
                        f"{name}: {service} is handed {variable} in its environment\n"
                        f"{CONTINUATION}its value is a secret file's, which the service reads from /run/secrets",
                    )
                )
    return findings


def local(model: dict[str, Any], name: str) -> list[Finding]:
    """Every published port binds a loopback address, the edge's included.

    The local stack's database asks no login, so a port on any other interface serves it, and the
    stack, to the developer's whole network.
    """
    findings = host_network(model, name)
    for service, definition in sorted(services(model, name).items()):
        for port in definition.get("ports") or []:
            if not isinstance(port, dict):
                raise ValueError(f"{name}: {service} has a port Compose did not expand, so this is not its rendered model")
            if port.get("host_ip") not in LOOPBACK:
                where = port.get("host_ip") or "every interface"
                findings.append(
                    Finding(
                        f"{name}: {service} publishes {port.get('published')}->{port.get('target')} on {where}\n"
                        f"{CONTINUATION}nothing of the local stack is reachable off this host; bind 127.0.0.1",
                    )
                )
    return findings


def edge_mounts(model: dict[str, Any], name: str, project: Path, checkout: Path) -> tuple[list[tuple[str, str]], list[Finding]]:
    """The edge's `nginx/` mounts as (checkout path, container path), and a finding for each file mount.

    A file mount keeps the inode a pull replaces, so a reload re-reads the old file.
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
                    f"{name}: {EDGE_SERVICE} mounts {relative} at {volume.get('target')}, which is not a directory\n"
                    f"{CONTINUATION}a file mount keeps the file a pull replaced, and a reload re-reads it",
                )
            )
    if not pairs:
        findings.append(Finding(f"{name}: {EDGE_SERVICE} mounts nothing from {EDGE_CONFIG_ROOT}/, so it serves none of this checkout's edge"))
    return pairs, findings


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
    ones inherited from http level.
    """
    directories = [checkout / source for source, _ in sorted(pairs) if (checkout / source).is_dir()]
    return "\n".join(file.read_bytes().decode() for directory in directories for file in sorted(directory.iterdir()) if file.is_file())


def trusted_connector(conf: str, address: str, name: str) -> list[Finding]:
    """`set_real_ip_from` names the connector's address and nothing else, and the realip settings are declared once.

    Another address leaves every visitor keyed to the connector's; a wider one lets any host on it name a visitor.
    Every depth is read, since nginx takes a whole `location { … }` on one line.
    """
    declared: dict[str, list[str]] = {}
    for directive in walk(parse(conf, name)):
        if directive.block is None and directive.args:
            declared.setdefault(directive.name, []).append(" ".join(directive.args))
    trusted = declared.get("set_real_ip_from", [])
    findings: list[Finding] = []
    if trusted != [address]:
        findings.append(
            Finding(
                f"{name} trusts {trusted or 'nothing'} with set_real_ip_from, and the connector is {address}\n"
                f"{CONTINUATION}the edge takes a visitor's address from the connector alone",
            )
        )
    for directive, expected in REALIP_SETTINGS.items():
        values = declared.get(directive, [])
        if values != [expected]:
            findings.append(
                Finding(
                    f"{name} declares {directive} {values or 'nowhere'}, not once as {expected}\n"
                    f"{CONTINUATION}a second one, in a server or a location, replaces the shared one there",
                )
            )
    return findings


# The frontend's deployment name on each stack, which decides whether it mails anyone and which files
# its boot demands: booted under another, it refuses nothing.
DEPLOYMENT_NAMES: Final = {"production": "production", "local": "local"}


def deployment_name(model: dict[str, Any], name: str, stack: str) -> list[Finding]:
    """The frontend's `APP_ENV` is the stack's own, written in the compose file above the package's environment file."""
    environment = (services(model, name).get("frontend") or {}).get("environment") or {}
    if not isinstance(environment, dict):
        raise ValueError(f"{name}: frontend has an environment Compose did not render as a mapping, so this is not its rendered model")
    expected = DEPLOYMENT_NAMES[stack]
    if environment.get("APP_ENV") == expected:
        return []
    return [
        Finding(
            f"{name}: the frontend runs as APP_ENV {environment.get('APP_ENV')!r}, not {expected!r}\n"
            f"{CONTINUATION}its boot then demands another stack's files and mails as that stack does",
        )
    ]


ENV_FILES: Final = {"frontend": "fl_frontend/.env", "backend": "fl_backend/.env"}
# The prefix of the name each of the gate's stand-in environment files carries, a name of its own
# valued with its path.
STAND_IN_READ: Final = "FL_STAND_IN_READ_"


def env_files(model: dict[str, Any], name: str) -> list[Finding]:
    """Each service reads its package's file and no other.

    A second file hands the container settings nobody reading the package's own file sees, and the
    other package's file hands it that package's settings.
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
        if read != [expected]:
            findings.append(
                Finding(
                    f"{name}: {service} reads the environment files {read}, not {expected} alone\n"
                    f"{CONTINUATION}a service's settings are its own package's file and nothing beside it",
                )
            )
    return findings


@dataclass(frozen=True)
class Stack:
    """One rendered model as every rule reads it.

    `name` is the stack's, which the tables key by and every finding opens with; `project` is the directory Compose
    resolved the model's paths against; `connector` is production's connector address, which either edge trusts
    alone, since the local stack starts no connector and an edge trusting what the other does not serves another
    edge's configuration.
    """

    model: dict[str, Any]
    name: str
    project: Path
    connector: str


# How each stack's edge names itself in a finding about its trust.
EDGE_NAMES: Final = {"production": "production's edge", "local": "the local edge"}


def exposure(stack: Stack) -> list[Finding]:
    """What a stack publishes: production nothing, the local stack loopback alone."""
    return production(stack.model, stack.name) if stack.name == "production" else local(stack.model, stack.name)


def edge(stack: Stack) -> list[Finding]:
    """The edge's mounts, and the trust the configuration those mounts carry places in the connector."""
    pairs, findings = edge_mounts(stack.model, stack.name, stack.project, REPO_ROOT)
    return findings + trusted_connector(edge_configuration(pairs, REPO_ROOT), stack.connector, EDGE_NAMES[stack.name])


# Every rule `main` runs, each over both stacks: a rule written and left out of this table is one nothing runs,
# which the table makes a reader's to see rather than a sequence of calls to miss. A rule refuses a model that is
# not one Compose rendered by raising `ValueError`.
RULES: Final[tuple[Callable[[Stack], list[Finding]], ...]] = (
    exposure,
    edge,
    lambda stack: env_files(stack.model, stack.name),
    lambda stack: deployment_name(stack.model, stack.name, stack.name),
    lambda stack: networks(stack.model, stack.name),
    lambda stack: privileges(stack.model, stack.name),
    lambda stack: secret_holders(stack.model, stack.name, stack.project, stack.name),
    lambda stack: local_logins(stack.model, stack.name),
    lambda stack: moved_names(stack.model, stack.name),
    lambda stack: secrets_directory(stack.model, stack.name, stack.project),
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Does either stack expose more than its edge, or mount the edge's configuration by file?")
    parser.add_argument("production", metavar="PROD_JSON", help="docker compose -f docker-compose.yml config --format json")
    parser.add_argument("local", metavar="LOCAL_JSON", help="the same, with docker-compose.local.yml merged over it")
    args = parser.parse_args()
    try:
        prod_model = json.loads(Path(args.production).read_bytes())
        local_model = json.loads(Path(args.local).read_bytes())
        connector = connector_address(prod_model, "production")
        stacks = (
            Stack(prod_model, "production", Path(args.production).resolve().parent, connector),
            Stack(local_model, "local", Path(args.local).resolve().parent, connector),
        )
        findings = [finding for rule in RULES for stack in stacks for finding in rule(stack)]
    except (*UNREADABLE, ValueError, NginxSyntax) as error:
        print(f"      {error}", file=sys.stderr)
        print("      Nothing was judged, so this is a refusal rather than a verdict on either stack.", file=sys.stderr)
        return EXIT_REFUSED
    code = report_findings(findings)
    if not findings:
        print(f"      production publishes nothing and runs {len(PRODUCTION_SERVICES)} services; locally every port binds loopback")
        print(f"      both edges mount {EDGE_CONFIG_ROOT}/ by directory")
        print(f"      either edge trusts the {CONNECTOR_SERVICE} address alone")
        print("      each application service reads its package's environment file alone")
        print("      each stack's frontend runs under that stack's own deployment name")
        print(f"      the connector shares a network with {EDGE_SERVICE} alone, and the application pair with {EDGE_SERVICE} alone")
        print(f"      every service drops every capability and gains no privilege, {EDGE_SERVICE} adding back its master's three")
        print("      each secret is held by the services SECRET_HOLDERS names alone, read from its own file, in both stacks")
        print(f"      the local stack's logins are inline configs naming its own {LOCAL_DATABASE_SERVICE} service alone")
        print("      no service is handed a moved credential's name in its environment")
        print(f"      no service mounts {SECRETS_PATH}/ but through a secret naming its file")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
