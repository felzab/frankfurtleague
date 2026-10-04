"""SCRIPTS · the models Compose renders, against each stack's rules and the files that must agree.

`docker compose config` merges the files, applies the profiles, expands every short-syntax port and
volume and resolves each service's environment, so this reads the model the engine is handed rather
than parsing YAML again. Each rule states its invariant at its own function, beside the
`docs/ops/spec.md` row it holds.
"""

from __future__ import annotations

import argparse
import ast
import builtins
import json
import re
import sys
from collections import Counter
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Final, NamedTuple
from urllib.parse import urlsplit

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

# The checkout directory every credential file sits in, reached by nothing but a secret naming its file.
SECRETS_PATH: Final = "secrets"
# Where a service reads each file a secret or a config hands it (`fl_frontend/src/core/config.ts :: DEFAULT_SECRETS_DIR`).
RUN_SECRETS: Final = "/run/secrets"
# The local stack's database service, the one host its logins may name.
LOCAL_DATABASE_SERVICE: Final = "mongo"

_FRONTEND: Final = frozenset({"frontend"})
_BACKEND: Final = frozenset({"backend"})
# The three internal keys: one file each, read by both services (`docs/ops/spec.md :: I11`).
_BOTH: Final = frozenset({"frontend", "backend"})
_EITHER_STACK: Final = {
    # A holder of it mints any actor the backend trusts (I472).
    "fl_actor_signing_key": _FRONTEND,
    "auth_secret": _FRONTEND,
    "sperrliste_schluessel": _BACKEND,
    "internal_api_key_base": _BOTH,
    "internal_api_key_system": _BOTH,
    "internal_api_key_admin": _BOTH,
}

# Every secret each stack declares, as (its holders, the checkout file it is read from): a holder that
# does not read it is one more place it leaks from, and a reader lacking it refuses its boot (I508).
SECRET_HOLDERS: Final[dict[str, dict[str, tuple[frozenset[str], str]]]] = {
    "production": {
        **{secret: (holders, f"{SECRETS_PATH}/{secret}") for secret, holders in _EITHER_STACK.items()},
        "tunnel_token": (frozenset({"cloudflared"}), f"{SECRETS_PATH}/tunnel_token"),
        "auth_resend_key": (_FRONTEND, f"{SECRETS_PATH}/auth_resend_key"),
        "resend_webhook_secret": (_FRONTEND, f"{SECRETS_PATH}/resend_webhook_secret"),
        "turnstile_secret_key": (_FRONTEND, f"{SECRETS_PATH}/turnstile_secret_key"),
        "frontend_mongodb_uri": (_FRONTEND, f"{SECRETS_PATH}/frontend_mongodb_uri"),
        "backend_mongodb_uri": (_BACKEND, f"{SECRETS_PATH}/backend_mongodb_uri"),
    },
    # No connector, no mail and no provider event; both logins are `CONFIG_HOLDERS`'.
    "local": {secret: (holders, f"{SECRETS_PATH}/{secret}") for secret, holders in _EITHER_STACK.items()},
}

# Every file each stack hands a service as an inline config at `RUN_SECRETS`, by its holders: the local
# stack's logins, which name its own database and no credential, so no machine keeps production's (I508).
CONFIG_HOLDERS: Final[dict[str, dict[str, frozenset[str]]]] = {
    "production": {},
    "local": {"frontend_mongodb_uri": _FRONTEND, "backend_mongodb_uri": _BACKEND},
}

# The environment names those files replace: one in a service's `environment:` is a second copy of a
# credential beside its file (I509). `scripts/lib/_lib.sh :: MOVED_ENV_NAMES` spells this set again
# for the environment files' own check.
MOVED_ENV_NAMES: Final = frozenset(
    {
        "MONGODB_URI",
        "SPERRLISTE_SCHLUESSEL",
        "AUTH_SECRET",
        "AUTH_RESEND_KEY",
        "RESEND_WEBHOOK_SECRET",
        "INTERNAL_API_KEY_BASE",
        "INTERNAL_API_KEY_SYSTEM",
        "INTERNAL_API_KEY_ADMIN",
        "TURNSTILE_SECRET_KEY",
    }
)

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


# What each service adds back after dropping every capability: nginx's master fails to start without
# each of its four (`docker-compose.yml :: nginx`), and every other service runs as its own user.
CAPABILITIES_ADDED: Final = {EDGE_SERVICE: frozenset({"CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE"})}
# The spellings Compose documents for the option, a boolean one taking either separator or none.
NO_NEW_PRIVILEGES: Final = frozenset({"no-new-privileges", "no-new-privileges:true", "no-new-privileges=true"})


def _capabilities(listed: list[Any] | None) -> frozenset[str]:
    """Capability names as the kernel's list spells them, a `CAP_` prefix Docker also accepts dropped."""
    return frozenset(str(name).upper().removeprefix("CAP_") for name in listed or [])


def privileges(model: dict[str, Any], name: str) -> list[Finding]:
    """Every service drops every capability, takes `no-new-privileges`, and adds back only `CAPABILITIES_ADDED`'s.

    One left in place is one no start was shown to need, and NET_RAW reads the bridge a token crosses (I507).
    """
    findings: list[Finding] = []
    for service, definition in sorted(services(model, name).items()):
        dropped = _capabilities(definition.get("cap_drop"))
        added = _capabilities(definition.get("cap_add"))
        allowed = CAPABILITIES_ADDED.get(service, frozenset())
        if dropped != {"ALL"}:
            findings.append(Finding("fail", f"{name}: {service} drops {sorted(dropped) or 'nothing'}, not ALL (I507)"))
        if added != allowed:
            findings.append(
                Finding("fail", f"{name}: {service} adds back {sorted(added) or 'nothing'}, not {sorted(allowed) or 'nothing'} (I507)")
            )
        if not NO_NEW_PRIVILEGES & set(definition.get("security_opt") or []):
            findings.append(Finding("fail", f"{name}: {service} does not set no-new-privileges (I507)"))
    return findings


def _declared_file(declared: object, project: Path) -> str:
    """A top-level secret's or config's `file`, relative to the rendered project where it sits inside it."""
    source_file = Path(str((declared.get("file") if isinstance(declared, dict) else None) or ""))
    return source_file.relative_to(project).as_posix() if source_file.is_relative_to(project) else source_file.as_posix()


def secrets_directory(model: dict[str, Any], name: str, project: Path) -> list[Finding]:
    """No bind mount and no config reaches into `SECRETS_PATH`, nor mounts one holding it.

    A secret is the one route a file there takes, so each reaches only the service naming it (I472, I508).
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
                        "fail",
                        f"{name}: {service} bind-mounts {source} at {volume.get('target')}, which reaches {directory.name}/\n"
                        f"{CONTINUATION}a file there reaches a service as a Compose secret naming it, and no other way (I472)",
                    )
                )
    for config, declared in sorted((model.get("configs") or {}).items()):
        if (project / _declared_file(declared, project)).is_relative_to(directory):
            findings.append(Finding("fail", f"{name}: the config {config} is read from {directory.name}/, where only secrets are (I472)"))
    return findings


def secret_holders(model: dict[str, Any], name: str, project: Path, stack: str) -> list[Finding]:
    """Exactly `SECRET_HOLDERS[stack]`: each declared, read from its file, and held by its services alone at `/run/secrets/<name>`.

    A second name reading one file is that credential under an alias, so an undeclared name is a finding too (I472, I508).
    """
    expected = SECRET_HOLDERS[stack]
    declared = model.get("secrets") or {}
    findings: list[Finding] = []
    for secret in sorted(set(declared) - set(expected)):
        findings.append(Finding("fail", f"{name}: the secret {secret} is declared and SECRET_HOLDERS lists no such secret (I508)"))
    held: dict[str, list[str]] = {secret: [] for secret in expected}
    for service, definition in sorted(services(model, name).items()):
        for entry in definition.get("secrets") or []:
            source = str(entry.get("source") if isinstance(entry, dict) else entry)
            if source not in held:
                continue
            held[source].append(service)
            target = str((entry.get("target") if isinstance(entry, dict) else None) or source)
            # A relative target is a name under `/run/secrets` (https://docs.docker.com/reference/compose-file/services/#secrets).
            mounted = target if target.startswith("/") else f"{RUN_SECRETS}/{target}"
            if mounted != f"{RUN_SECRETS}/{source}":
                findings.append(Finding("fail", f"{name}: {service} mounts {source} at {mounted}, not {RUN_SECRETS}/{source} (I508)"))
    for secret, (holders, source_file) in sorted(expected.items()):
        if secret not in declared:
            findings.append(Finding("fail", f"{name}: the secret {secret} is not declared, and {sorted(holders)} read it (I508)"))
            continue
        read = _declared_file(declared[secret], project)
        if read != source_file:
            findings.append(Finding("fail", f"{name}: {secret} is read from {read!r}, not {source_file} (I508)"))
        if sorted(held[secret]) != sorted(holders):
            findings.append(Finding("fail", f"{name}: {held[secret] or 'nothing'} holds {secret}, not {sorted(holders)} (I508)"))
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


def config_holders(model: dict[str, Any], name: str, stack: str) -> list[Finding]:
    """Exactly `CONFIG_HOLDERS[stack]` mounted at `RUN_SECRETS`, each by its services alone and naming this stack's database.

    A service reads any file there as a credential, so a config nothing lists there is one no secret table checks (I508).
    """
    expected = CONFIG_HOLDERS[stack]
    declared = model.get("configs") or {}
    services_declared = services(model, name)
    held: dict[str, list[str]] = {file: [] for file in expected}
    findings: list[Finding] = []
    for service, definition in sorted(services_declared.items()):
        for entry in definition.get("configs") or []:
            if not isinstance(entry, dict):
                raise ValueError(f"{name}: {service} has a config Compose did not expand, so this is not its rendered model")
            source = str(entry.get("source"))
            # A config's default target is `/<source>` (https://docs.docker.com/reference/compose-file/services/#configs).
            target = str(entry.get("target") or f"/{source}")
            directory, _, file = target.rpartition("/")
            if directory != RUN_SECRETS:
                continue
            if file not in held:
                findings.append(
                    Finding("fail", f"{name}: {service} mounts the config {source} at {target}, a file CONFIG_HOLDERS lacks (I508)")
                )
                continue
            held[file].append(service)
            if (wrong := _not_the_local_database((declared.get(source) or {}).get("content"), services_declared)) is not None:
                findings.append(
                    Finding(
                        "fail",
                        f"{name}: the config {source}, which {service} reads at {target}, {wrong}\n"
                        f"{CONTINUATION}a login there aims the stack at a database other than its own (I508)",
                    )
                )
    for file, holders in sorted(expected.items()):
        if sorted(held[file]) != sorted(holders):
            findings.append(Finding("fail", f"{name}: {held[file] or 'nothing'} reads a config as {file}, not {sorted(holders)} (I508)"))
    return findings


# The frontend's schema, the one declaration of the files it reads from `RUN_SECRETS`.
FRONTEND_CONFIG: Final = REPO_ROOT / "fl_frontend" / "src" / "core" / "config.ts"
FRONTEND_SERVICE: Final = "frontend"


def frontend_schema_files(config: Path) -> tuple[frozenset[str], frozenset[str]]:
    """Every file the schema reads, and those it demands of production alone.

    Read off `fl_frontend/src/core/config.ts :: SECRET_FILES`, `:: PRODUCTION_ONLY_REQUIRED` and the
    signing key's path as spelled there, any other line shape refusing, so nothing here is a copy.
    """
    text = config.read_bytes().decode()
    block = re.search(r"^const SECRET_FILES = \{\n(.*?)^\} as const;$", text, re.MULTILINE | re.DOTALL)
    demanded = re.search(r"^const PRODUCTION_ONLY_REQUIRED = \[([^\]]*)\] as const", text, re.MULTILINE)
    signing = re.search(r'^\s+ACTOR_SIGNING_KEY_FILE: z\.[^\n]*\.default\("/run/secrets/([a-z_]+)"\),$', text, re.MULTILINE)
    if block is None or demanded is None or signing is None:
        raise ValueError(f"{config.name} declares no SECRET_FILES, PRODUCTION_ONLY_REQUIRED or signing key path this reads")
    lines = [line.strip() for line in block.group(1).splitlines() if line.strip()]
    pairs = [re.fullmatch(r'([A-Z_]+): "([a-z_]+)",', line) for line in lines]
    if not pairs or None in pairs:
        raise ValueError(f'{config.name} :: SECRET_FILES holds a line that is no `KEY: "file",` pair, so its files were not read')
    files = {match.group(1): match.group(2) for match in pairs if match is not None}
    production_only = re.findall(r'"([A-Z_]+)"', demanded.group(1))
    if unknown := sorted(set(production_only) - set(files)):
        raise ValueError(f"{config.name} :: PRODUCTION_ONLY_REQUIRED names {unknown}, which SECRET_FILES lacks")
    return frozenset(files.values()) | {signing.group(1)}, frozenset(files[key] for key in production_only)


def _mounted_files(definition: dict[str, Any]) -> frozenset[str]:
    """The files a service's secrets and configs place at `RUN_SECRETS`, by name."""
    mounted: set[str] = set()
    for entry in definition.get("secrets") or []:
        source = str(entry.get("source") if isinstance(entry, dict) else entry)
        target = str((entry.get("target") if isinstance(entry, dict) else None) or source)
        mounted.add(target if target.startswith("/") else f"{RUN_SECRETS}/{target}")
    for entry in definition.get("configs") or []:
        if not isinstance(entry, dict):
            raise ValueError("a service has a config Compose did not expand, so this is not its rendered model")
        mounted.add(str(entry.get("target") or f"/{entry.get('source')}"))
    return frozenset(path.removeprefix(f"{RUN_SECRETS}/") for path in mounted if path.rpartition("/")[0] == RUN_SECRETS)


def frontend_files(model: dict[str, Any], name: str, stack: str, schema: tuple[frozenset[str], frozenset[str]]) -> list[Finding]:
    """The frontend is handed every file its schema requires on this stack and none it never reads (I430).

    Production is handed every file the schema reads; any other stack needs none it demands of production alone.
    """
    reads, production_only = schema
    required = reads if stack == "production" else reads - production_only
    mounted = _mounted_files(services(model, name).get(FRONTEND_SERVICE) or {})
    findings: list[Finding] = []
    if missing := sorted(required - mounted):
        findings.append(
            Finding(
                "fail",
                f"{name}: the frontend's schema requires {missing} and compose mounts none of it at {RUN_SECRETS}\n"
                f"{CONTINUATION}its boot refuses, and nothing short of the deploy's preflight on the host says so (I430)",
            )
        )
    if extra := sorted(mounted - reads):
        findings.append(Finding("fail", f"{name}: compose hands the frontend {extra}, which its schema never reads (I430)"))
    return findings


# The backend's settings, whose secret half is the one declaration of the files it reads from `RUN_SECRETS`.
BACKEND_CONFIG: Final = REPO_ROOT / "fl_backend" / "app" / "core" / "config.py"
BACKEND_SERVICE: Final = "backend"
BACKEND_SECRETS: Final = "BackendSecrets"

# The pydantic classes a settings class may inherit from, each declaring no field of its own.
PYDANTIC_ROOTS: Final = frozenset({"BaseModel", "BaseSettings"})
PYDANTIC_PACKAGES: Final = frozenset({"pydantic", "pydantic_settings"})

# The backend's own package: a name imported from it may carry a `Field` this parse never opens.
BACKEND_PACKAGE: Final = "app"

# A class body holding any other statement runs it at class creation, so an annotation inside it is
# a field this would read past.
CLASS_STATEMENTS: Final = (ast.AnnAssign, ast.Assign, ast.Expr, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Pass)

BUILTIN_NAMES: Final = frozenset(dir(builtins))


class _Settings(NamedTuple):
    """One parse of the settings module: its classes, and how each of its module-level names is bound."""

    label: str
    classes: dict[str, ast.ClassDef]
    assigned: dict[str, ast.expr]
    imported: dict[str, str]
    defined: frozenset[str]
    bindings: Counter[str]


def _module_bindings(body: list[ast.stmt]) -> Counter[str]:
    """How often each module-level name is bound, inside a compound statement too; a function or a class is its own scope."""
    bound: Counter[str] = Counter()
    for node in body:
        targets: list[ast.expr] = []
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound[node.name] += 1
            continue
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            bound.update(alias.asname or alias.name.partition(".")[0] for alias in node.names)
        elif isinstance(node, ast.TypeAlias):
            targets = [node.name]
        elif isinstance(node, ast.Assign):
            targets = node.targets
        # An annotation without a value binds nothing.
        elif isinstance(node, ast.AnnAssign) and node.value is not None or isinstance(node, (ast.AugAssign, ast.For, ast.AsyncFor)):
            targets = [node.target]
        elif isinstance(node, (ast.With, ast.AsyncWith)):
            targets = [item.optional_vars for item in node.items if item.optional_vars is not None]
        bound.update(name.id for target in targets for name in ast.walk(target) if isinstance(name, ast.Name))
        for handler in getattr(node, "handlers", []):
            bound.update([handler.name] if handler.name else [])
            bound += _module_bindings(handler.body)
        for block in ("body", "orelse", "finalbody"):
            bound += _module_bindings(getattr(node, block, []))
        for case in getattr(node, "cases", []):
            bound += _module_bindings(case.body)
    return bound


def _settings(config: Path) -> _Settings:
    module = ast.parse(config.read_bytes().decode(), filename=config.name)
    imported: dict[str, str] = {}
    for node in module.body:
        if isinstance(node, ast.ImportFrom):
            imported.update((alias.asname or alias.name, "." * node.level + (node.module or "")) for alias in node.names)
        elif isinstance(node, ast.Import):
            imported.update((alias.asname or alias.name.partition(".")[0], alias.name) for alias in node.names)
    return _Settings(
        label=config.name,
        classes={node.name: node for node in module.body if isinstance(node, ast.ClassDef)},
        assigned={
            target.id: node.value
            for node in module.body
            if isinstance(node, (ast.Assign, ast.AnnAssign)) and node.value is not None
            for target in (node.targets if isinstance(node, ast.Assign) else [node.target])
            if isinstance(target, ast.Name)
        },
        imported=imported,
        defined=frozenset(node.name for node in module.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))),
        bindings=_module_bindings(module.body),
    )


def _names(node: ast.AST) -> Iterator[ast.Name]:
    """Every name `node` reads, never inside a lambda or a comprehension, whose own names no `Field` stands behind."""
    if isinstance(node, (ast.Lambda, ast.GeneratorExp, ast.ListComp, ast.SetComp, ast.DictComp)):
        return
    if isinstance(node, ast.Name):
        yield node
    for child in ast.iter_child_nodes(node):
        yield from _names(child)


def _resolved(settings: _Settings, expression: ast.expr, where: str, followed: frozenset[str] = frozenset()) -> list[ast.expr]:
    """`expression` and, transitively, the value of every module constant it names, so a `Field` behind an alias is read.

    A name not followed to one plain module-level assignment, a definition, a library's import or a
    builtin refuses.
    """
    parts = [expression]
    for node in _names(expression):
        # A ring adds no part; `_constant_behind` refuses one a value is read through. Recursive, as
        # `_constant_behind` is, so this check gone overflows the stack rather than looping for good.
        if node.id in followed:
            continue
        origin = settings.imported.get(node.id)
        if settings.bindings[node.id] > 1:
            raise ValueError(f"{where} names {node.id}, which {settings.label} binds more than once, and this reads one of them")
        if node.id in settings.assigned:
            parts += _resolved(settings, settings.assigned[node.id], where, followed | {node.id})
        elif origin is not None:
            if origin.startswith(".") or origin.partition(".")[0] == BACKEND_PACKAGE:
                raise ValueError(f"{where} names {node.id} from {origin}, a module this does not read")
        elif node.id not in settings.defined and node.id not in BUILTIN_NAMES:
            raise ValueError(f"{where} names {node.id}, which {settings.label} binds nowhere this reads")
    return parts


def _constant_behind(settings: _Settings, expression: ast.expr, followed: frozenset[str] = frozenset()) -> ast.expr:
    """What a module constant holds, followed through every constant naming another."""
    if not (isinstance(expression, ast.Name) and expression.id in settings.assigned):
        return expression
    # Recursive rather than a loop over a visited set, as `_declared_fields` is: with this check gone a
    # ring overflows the stack and fails the run, where a loop would hang it.
    if expression.id in followed:
        raise ValueError(f"{settings.label} binds {expression.id} through a ring of constants that holds no value")
    return _constant_behind(settings, settings.assigned[expression.id], followed | {expression.id})


def _callee(node: ast.expr) -> str | None:
    """A call's function as its last name spells it, so `Field(...)` and `pydantic.Field(...)` read alike."""
    if not isinstance(node, ast.Call):
        return None
    return node.func.id if isinstance(node.func, ast.Name) else node.func.attr if isinstance(node.func, ast.Attribute) else None


def _is_class_var(annotation: ast.expr) -> bool:
    """`ClassVar` or `ClassVar[...]`, which pydantic reads as no field."""
    named = annotation.value if isinstance(annotation, ast.Subscript) else annotation
    return (isinstance(named, ast.Name) and named.id == "ClassVar") or (isinstance(named, ast.Attribute) and named.attr == "ClassVar")


def _is_pydantic_root(settings: _Settings, base: ast.expr) -> bool:
    """`BaseModel` or `BaseSettings`, imported from pydantic by name or reached through its module."""
    if isinstance(base, ast.Name):
        name, module = base.id, settings.imported.get(base.id, "")
    elif isinstance(base, ast.Attribute) and isinstance(base.value, ast.Name):
        name, module = base.attr, settings.imported.get(base.value.id, "")
    else:
        return False
    return name in PYDANTIC_ROOTS and module.partition(".")[0] in PYDANTIC_PACKAGES


def _declared_fields(settings: _Settings, name: str, below: frozenset[str] = frozenset()) -> dict[str, ast.AnnAssign]:
    """The model fields `name` declares and inherits from this module's classes, its own winning, as pydantic merges them."""
    if name in below:
        raise ValueError(f"{settings.label} :: {name} inherits from itself through {', '.join(sorted(below))}")
    fields: dict[str, ast.AnnAssign] = {}
    for base in settings.classes[name].bases:
        if isinstance(base, ast.Name) and base.id in settings.classes:
            fields |= _declared_fields(settings, base.id, below | {name})
        elif not _is_pydantic_root(settings, base):
            raise ValueError(f"{settings.label} :: {name} inherits from {ast.unparse(base)}, whose fields this does not read")
    for node in settings.classes[name].body:
        if not isinstance(node, CLASS_STATEMENTS):
            raise ValueError(f"{settings.label} :: {name} holds a {type(node).__name__} statement, which this does not read into")
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            # A leading underscore is a private attribute, never a field.
            if not node.target.id.startswith("_") and node.target.id != "model_config" and not _is_class_var(node.annotation):
                fields[node.target.id] = node
    return fields


def _field_file(settings: _Settings, field: ast.AnnAssign, where: str) -> tuple[str, bool]:
    """The file a field is read from, its `validation_alias` or its own name, and whether a default spares the boot it."""
    name = field.target.id if isinstance(field.target, ast.Name) else ""
    # pydantic merges a `Field` in the annotation, or in a type alias the module declares, with the assigned one.
    calls = [
        node
        for part in _resolved(settings, field.annotation, where)
        for node in ast.walk(part)
        if isinstance(node, ast.Call) and _callee(node) == "Field"
    ]
    value = None
    if field.value is not None:
        _resolved(settings, field.value, where)
        # A constant holding a `Field` is that `Field` to pydantic.
        value = _constant_behind(settings, field.value)
    defaulted = value is not None
    if isinstance(value, ast.Call) and _callee(value) == "Field":
        calls.append(value)
        # `Field(...)` is the one positional default that still demands a value.
        defaulted = bool(value.args) and not (isinstance(value.args[0], ast.Constant) and value.args[0].value is Ellipsis)
    files: set[str] = set()
    for call in calls:
        for keyword in call.keywords:
            if keyword.arg in {"default", "default_factory"}:
                defaulted = True
            elif keyword.arg is None or keyword.arg == "alias":
                raise ValueError(f"{where} may name its file by a keyword this does not read")
            elif keyword.arg == "validation_alias":
                alias = _constant_behind(settings, keyword.value)
                if not (isinstance(alias, ast.Constant) and isinstance(alias.value, str)):
                    raise ValueError(f"{where} has a validation_alias that is neither a string nor a module constant holding one")
                files.add(alias.value)
    if len(files) > 1:
        raise ValueError(f"{where} declares two validation_alias values, {sorted(files)}, and pydantic reads one")
    return (files.pop() if files else name), defaulted


def backend_schema_files(config: Path) -> tuple[frozenset[str], frozenset[str]]:
    """Every file the backend's secret half reads, and those it cannot boot without.

    Parsed rather than imported from `fl_backend/app/core/config.py :: BackendSecrets`, since the ops
    scope's interpreter may lack pydantic; anything it cannot follow refuses.
    """
    settings = _settings(config)
    if BACKEND_SECRETS not in settings.classes:
        raise ValueError(f"{config.name} declares no {BACKEND_SECRETS} class, so the backend's files were not read")
    reads: set[str] = set()
    required: set[str] = set()
    for field, node in sorted(_declared_fields(settings, BACKEND_SECRETS).items()):
        file, defaulted = _field_file(settings, node, f"{config.name} :: {BACKEND_SECRETS}.{field}")
        reads.add(file)
        if not defaulted:
            required.add(file)
    if not reads:
        raise ValueError(f"{config.name} :: {BACKEND_SECRETS} declares no field, so the backend's files were not read")
    return frozenset(reads), frozenset(required)


def backend_files(model: dict[str, Any], name: str, schema: tuple[frozenset[str], frozenset[str]]) -> list[Finding]:
    """The backend is handed every file its secret half requires and none it never reads, on either stack (I430)."""
    reads, required = schema
    mounted = _mounted_files(services(model, name).get(BACKEND_SERVICE) or {})
    findings: list[Finding] = []
    if missing := sorted(required - mounted):
        findings.append(
            Finding(
                "fail",
                f"{name}: the backend's schema requires {missing} and compose mounts none of it at {RUN_SECRETS}\n"
                f"{CONTINUATION}its boot refuses, and nothing short of the deploy's preflight on the host says so (I430)",
            )
        )
    if extra := sorted(mounted - reads):
        findings.append(Finding("fail", f"{name}: compose hands the backend {extra}, which its schema never reads (I430)"))
    return findings


def moved_names(model: dict[str, Any], name: str) -> list[Finding]:
    """No service is handed a name in `MOVED_ENV_NAMES` through `environment:`, in any letter case (I509).

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
                        "fail",
                        f"{name}: {service} is handed {variable} in its environment\n"
                        f"{CONTINUATION}its value is a secret file's, which the service reads from /run/secrets (I509)",
                    )
                )
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


# Each application service's environment file, relative to the checkout (`docs/ops/spec.md :: I429`).
ENV_FILES: Final = {"frontend": "fl_frontend/.env", "backend": "fl_backend/.env"}
# The prefix of the name each of the gate's stand-in environment files carries, a name of its own
# valued with its path.
STAND_IN_READ: Final = "FL_STAND_IN_READ_"


def env_files(model: dict[str, Any], name: str) -> list[Finding]:
    """Each service reads its package's file and no other.

    `scripts/ops/deploy.sh :: read_env_names` hands each reader that file alone, so any other list
    passes the preflight and meets the boot gate after the recreate.
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
                    "fail",
                    f"{name}: {service} reads the environment files {read}, not {expected} alone\n"
                    f"{CONTINUATION}the deploy judges the package's file as the whole of what the container is handed (I429)",
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
        findings += privileges(prod_model, "production") + privileges(local_model, "local")
        findings += secret_holders(prod_model, "production", Path(args.production).resolve().parent, "production")
        findings += secret_holders(local_model, "local", Path(args.local).resolve().parent, "local")
        findings += config_holders(prod_model, "production", "production") + config_holders(local_model, "local", "local")
        schema = frontend_schema_files(FRONTEND_CONFIG)
        findings += frontend_files(prod_model, "production", "production", schema) + frontend_files(local_model, "local", "local", schema)
        settings = backend_schema_files(BACKEND_CONFIG)
        findings += backend_files(prod_model, "production", settings) + backend_files(local_model, "local", settings)
        findings += moved_names(prod_model, "production") + moved_names(local_model, "local")
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
        print("      each application service reads its package's environment file alone")
        print(f"      the connector shares a network with {EDGE_SERVICE} alone, and the application pair with {EDGE_SERVICE} alone")
        print(f"      every service drops every capability and gains no privilege, {EDGE_SERVICE} adding back its master's four")
        print("      each secret is held by the services SECRET_HOLDERS names alone, read from its own file, in both stacks")
        print(f"      the local stack's logins are inline configs naming its own {LOCAL_DATABASE_SERVICE} service alone")
        print("      no service is handed a moved credential's name in its environment")
        print("      each application service is handed every file its schema requires on each stack, and none it never reads")
        print(f"      no service mounts {SECRETS_PATH}/ but through a secret naming its file")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
