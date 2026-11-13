"""The checks over the models Compose renders

The models here are written in the long form `docker compose config` renders ports and volumes in
(https://docs.docker.com/reference/compose-file/services/#long-syntax-4), so each case pins the
rule rather than either compose file's current wording.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
from pathlib import Path
from typing import Any, Final

import pytest
from conftest import BASH, base_env, import_scripts, new_root, run_shell, write_shell

[checker] = import_scripts("check_compose_model")


def model(**services: dict[str, Any]) -> dict[str, Any]:
    return {"services": services}


def port(published: str, target: int, host_ip: str | None = None) -> dict[str, Any]:
    rendered: dict[str, Any] = {"mode": "ingress", "target": target, "published": published, "protocol": "tcp"}
    if host_ip is not None:
        rendered["host_ip"] = host_ip
    return rendered


PRODUCTION = model(frontend={}, backend={}, nginx={}, cloudflared={})


def test_a_database_joining_production_fails():
    """The pinned set is what a `mongo` service breaks."""
    assert len(checker.production(model(**PRODUCTION["services"], mongo={}), "p")) == 1


def test_any_production_port_fails_the_edge_included():
    """Production's nginx publishes nothing either; the connector reaches it over the network."""
    found = checker.production(model(frontend={}, backend={}, nginx={"ports": [port("80", 80)]}, cloudflared={}), "p")
    assert len(found) == 1


def test_host_networking_fails_although_it_declares_no_port():
    found = checker.production(model(frontend={"network_mode": "host"}, backend={}, nginx={}, cloudflared={}), "p")
    assert len(found) == 1


def test_locally_the_edge_on_every_interface_fails():
    """The local stack serves a copy of production's data, so its edge is no exception, and its database asks no login."""
    assert len(checker.local(model(nginx={"ports": [port("3000", 80)]}, mongo={"ports": [port("27017", 27017)]}), "l")) == 2


def test_a_port_compose_did_not_expand_refuses():
    """A short-syntax string means the input is not a rendered model, which is a refusal, not a pass."""
    try:
        checker.local(model(mongo={"ports": ["27017:27017"]}), "l")
    except ValueError:
        return
    raise AssertionError("a short-syntax port was judged")


def test_a_document_without_services_refuses():
    try:
        checker.production({"name": "x"}, "p")
    except ValueError:
        return
    raise AssertionError("a model with no services was judged")


# --- the edge's configuration mounts ------------------------------------------------------------------

# Where the gate renders the models, and a checkout holding the two directories and one file in each.
PROJECT = Path("/render")


def checkout() -> Path:
    root = new_root("fl-compose-mounts-")
    for directory in ("nginx/prod", "nginx/shared"):
        (root / directory).mkdir(parents=True)
    (root / "nginx/prod/prod.conf").write_bytes(b"# the edge\n")
    return root


def bind(source: str, target: str) -> dict[str, Any]:
    """A volume as `docker compose config` renders either syntax: absolute, against the project directory."""
    return {"type": "bind", "source": str(PROJECT / source), "target": target, "read_only": True}


def edge(*volumes: dict[str, Any]) -> dict[str, Any]:
    return model(nginx={"volumes": list(volumes)})


DIRECTORIES = (bind("nginx/prod", "/etc/nginx/conf.d"), bind("nginx/shared", "/etc/nginx/shared"))


def test_a_single_file_mount_fails_whichever_syntax_wrote_it():
    """The rendered model is the same for `./nginx/prod/prod.conf:...` and a long-syntax `source:`, which is why it is read here."""
    rendered = edge(bind("nginx/prod/prod.conf", "/etc/nginx/conf.d/default.conf"), DIRECTORIES[1])
    _, findings = checker.edge_mounts(rendered, "p", PROJECT, checkout())

    assert len(findings) == 1
    assert "nginx/prod/prod.conf" in findings[0].detail


def test_an_edge_mounting_nothing_from_the_checkout_fails():
    _, findings = checker.edge_mounts(edge(bind(".tmp-mail", "/app/.tmp-mail")), "p", PROJECT, checkout())

    assert len(findings) == 1


def test_a_short_syntax_volume_refuses():
    try:
        checker.edge_mounts(model(nginx={"volumes": ["./nginx/prod:/etc/nginx/conf.d:ro"]}), "p", PROJECT, checkout())
    except ValueError:
        return
    raise AssertionError("a short-syntax volume was judged")


# --- the connector production's edge trusts ---------------------------------------------------------

CONNECTOR = "172.30.0.250"


def conf(real_ip: str = f"set_real_ip_from {CONNECTOR};") -> str:
    """An edge's trust, as `nginx/shared/http.conf` spells it."""
    return f"{real_ip}\nreal_ip_header CF-Connecting-IP;\n"


def test_a_realip_header_a_server_overrides_fails():
    """nginx takes a level's own setting over the inherited one, so a server reading another header trusts what a client writes there."""
    assert len(checker.trusted_connector(conf() + "server {\n    real_ip_header X-Forwarded-For;\n}\n", CONNECTOR, "c")) == 1


@pytest.mark.parametrize(
    "statement",
    ["set_real_ip_from 0.0.0.0/0;"],
    ids=["trust"],
)
def test_a_realip_directive_inside_a_one_line_block_fails(statement: str):
    """nginx reads statements, not lines: a directive after the `{` on the block's own line takes effect all the same."""
    one_line = f"location = /probe {{ {statement} return 204; }}\n"

    assert len(checker.trusted_connector(conf() + one_line, CONNECTOR, "c")) == 1


def test_a_realip_header_declared_nowhere_fails():
    """nginx's default is X-Real-IP, which the connector never sends, so every visitor would read as the connector."""
    assert len(checker.trusted_connector(conf().replace("real_ip_header CF-Connecting-IP;\n", ""), CONNECTOR, "c")) == 1


def test_trust_moved_off_the_connector_fails():
    """Every visitor is then keyed to the connector's own address, one rate-limit bucket for the site."""
    assert len(checker.trusted_connector(conf(real_ip="set_real_ip_from 172.30.0.251;"), CONNECTOR, "c")) == 1


def test_trust_widened_beside_the_connector_fails():
    """A second range lets any host inside it name the visitor."""
    widened = conf(real_ip=f"set_real_ip_from {CONNECTOR};\nset_real_ip_from 173.245.48.0/20;")

    assert len(checker.trusted_connector(widened, CONNECTOR, "c")) == 1


def mounted(prod: str, shared: str) -> Path:
    """A checkout whose two mounted directories hold one file each."""
    root = new_root("fl-compose-trust-")
    for directory, text in (("nginx/prod", prod), ("nginx/shared", shared)):
        (root / directory).mkdir(parents=True)
        (root / directory / "edge.conf").write_bytes(text.encode())
    return root


PAIRS = [("nginx/prod", "/etc/nginx/conf.d"), ("nginx/shared", "/etc/nginx/shared")]


def test_trust_an_entry_file_adds_beside_the_shared_one_fails():
    """A server block's own `set_real_ip_from` replaces the shared list for that server, so any other address there is trusted."""
    widened = mounted("server {\n    set_real_ip_from 173.245.48.0/20;\n}\n", conf())

    assert len(checker.trusted_connector(checker.edge_configuration(PAIRS, widened), CONNECTOR, "c")) == 1


def test_a_mounted_directory_the_checkout_lacks_is_left_to_the_mount_check():
    """`edge_mounts` reports it as a finding; reading it here would turn that finding into a refusal."""
    root = mounted("", conf())
    missing = [*PAIRS, ("nginx/absent", "/etc/nginx/absent")]

    assert checker.trusted_connector(checker.edge_configuration(missing, root), CONNECTOR, "c") == []


EDGE: Final = checker.EDGE_NETWORK
APP: Final = checker.APP_NETWORK
# The connector as production renders it: on the edge network alone, at its static address.
CONNECTED: Final = {"networks": {EDGE: {"ipv4_address": CONNECTOR}}}


def joined(*networks: str) -> dict[str, Any]:
    """A service's `networks` as Compose renders a list of names: each a key with no settings."""
    return {"networks": dict.fromkeys(networks)}


def env_file(*paths: str) -> dict[str, Any]:
    """A service's environment as Compose resolves it from the gate's stand-ins for `paths`.

    Each stand-in's own name is suffixed by its position here; the checker reads only the values.
    """
    return {"environment": {f"{checker.STAND_IN_READ}{position}": path for position, path in enumerate(paths, start=1)}}


def rendered_stack(project: Path, conf_dir: str, **extra: dict[str, Any]) -> dict[str, Any]:
    """A stack as the gate renders it beside `project`, its edge mounting `conf_dir` and `nginx/shared` there.

    `nginx/local` is the local stack's edge, and the stack's secrets follow from it.
    """
    stack_name = "local" if conf_dir == "nginx/local" else "production"
    edge_volumes = [
        {"type": "bind", "source": str(project / conf_dir), "target": "/etc/nginx/conf.d"},
        {"type": "bind", "source": str(project / "nginx/shared"), "target": "/etc/nginx/shared"},
    ]
    nginx = {"volumes": edge_volumes, **joined(EDGE, APP)}
    frontend = {"environment": env_file("fl_frontend/.env")["environment"] | {"APP_ENV": stack_name}} | joined(APP)
    backend = env_file("fl_backend/.env") | joined(APP)
    # The local stack's database, which its logins name.
    database = {"mongo": joined(APP)} if stack_name == "local" else {}
    stack = {"nginx": nginx, "frontend": frontend, "backend": backend, **database, **extra}
    rendered = {
        service: definition | hardened(service) | holding(stack_name, service) | configured(stack_name, service)
        for service, definition in stack.items()
    }
    return model(**rendered) | declared_secrets(project, stack_name) | declared_configs(stack_name)


def hardened(service: str) -> dict[str, Any]:
    """A service's privileges as Compose renders the lists `docker-compose.yml` writes for it."""
    added = sorted(checker.CAPABILITIES_ADDED.get(service, ()))
    return {"cap_drop": ["ALL"], "security_opt": ["no-new-privileges:true"]} | ({"cap_add": added} if added else {})


def holding(stack: str, service: str) -> dict[str, Any]:
    """A service's secrets as Compose renders the short syntax: each one `SECRET_HOLDERS` gives it."""
    held = [{"source": secret} for secret, (holders, _) in sorted(checker.SECRET_HOLDERS[stack].items()) if service in holders]
    return {"secrets": held} if held else {}


def declared_secrets(project: Path, stack: str, **moved: str) -> dict[str, Any]:
    """The top-level `secrets` as Compose renders them, each file absolute under `project`; `moved` re-points one."""
    files: dict[str, str] = {secret: str(source) for secret, (_, source) in checker.SECRET_HOLDERS[stack].items()} | moved
    return {"secrets": {secret: {"file": str(project / source)} for secret, source in files.items()}}


def run_main(production: dict[str, Any], local: dict[str, Any], project: Path, monkeypatch) -> tuple[int, str]:
    """`main` over two rendered models beside `project`, the checkout their edges mount: its exit code and what it printed."""
    monkeypatch.setattr(checker, "REPO_ROOT", project)
    for name, rendered in (("production.json", production), ("local.json", local)):
        (project / name).write_bytes(json.dumps(rendered).encode())
    out = io.StringIO()
    argv_before = checker.sys.argv
    checker.sys.argv = ["check_compose_model.py", str(project / "production.json"), str(project / "local.json")]
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            code = checker.main()
    finally:
        checker.sys.argv = argv_before
    return code, out.getvalue()


def clean_pair(project: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """Both stacks as every rule wants them, their edges mounting a checkout at `project` whose shared file trusts the connector alone."""
    for directory, text in (("nginx/prod", ""), ("nginx/local", ""), ("nginx/shared", conf())):
        (project / directory).mkdir(parents=True, exist_ok=True)
        (project / directory / "edge.conf").write_bytes(text.encode())
    return rendered_stack(project, "nginx/prod", cloudflared=CONNECTED), rendered_stack(project, "nginx/local")


@pytest.mark.parametrize("failing", ["production", "local"])
def test_a_rule_in_the_table_that_fails_fails_the_run(failing: str, monkeypatch):
    """`main` runs `RULES` whole over both stacks, so this one case holds the wiring every rule reaches a reader through."""
    project = new_root("fl-compose-main-")
    production, local = clean_pair(project)
    code, said = run_main(production, local, project, monkeypatch)
    assert code == 0, said

    def planted(stack):
        return [checker.Finding("fail", f"{stack.name}: planted")] if stack.name == failing else []

    monkeypatch.setattr(checker, "RULES", (*checker.RULES, planted))
    code, said = run_main(production, local, project, monkeypatch)

    assert code == 1 and f"{failing}: planted" in said, said


def test_a_rule_that_refuses_a_model_exits_two(monkeypatch):
    """A refusal collapsed into a failure, or into a pass, sends a reader to the wrong repair."""
    project = new_root("fl-compose-main-")
    production, local = clean_pair(project)

    def refuses(stack):
        raise ValueError(f"{stack.name}: planted")

    monkeypatch.setattr(checker, "RULES", (*checker.RULES, refuses))
    code, said = run_main(production, local, project, monkeypatch)

    assert code == checker.EXIT_REFUSED and "planted" in said, said


@pytest.mark.parametrize("stack", ["production", "local"])
def test_a_frontend_under_another_deployment_name_or_none_fails(stack: str):
    """Compose ranks `environment` above the package's file, so the name the compose file writes is the one that boots."""
    project = new_root("fl-compose-deployment-")
    rendered = rendered_stack(project, "nginx/local" if stack == "local" else "nginx/prod")

    assert checker.deployment_name(rendered, "s", stack) == []
    for said in ("local" if stack == "production" else "production", None):
        environment = rendered["services"]["frontend"]["environment"] | {"APP_ENV": said}
        changed = model(**rendered["services"] | {"frontend": {"environment": {k: v for k, v in environment.items() if v is not None}}})
        assert len(checker.deployment_name(changed, "s", stack)) == 1, said


# --- the environment files each application service reads ---------------------------------------------


@pytest.mark.parametrize("second", [".env"], ids=["the-checkout-s"])
def test_a_second_file_beside_the_package_s_fails(second: str):
    """A name the second file hands the container is one nobody reading the package's own file sees."""
    rendered = model(frontend=env_file("fl_frontend/.env", second), backend=env_file("fl_backend/.env"))

    found = checker.env_files(rendered, "p")

    assert len(found) == 1 and "p: frontend reads the environment files" in found[0].detail, found


def test_another_package_s_file_in_place_of_its_own_fails():
    rendered = model(frontend=env_file("fl_backend/.env"), backend=env_file("fl_backend/.env"))

    assert len(checker.env_files(rendered, "p")) == 1


def test_a_model_whose_environment_compose_left_unresolved_fails():
    """A render keeping `env_file` and resolving nothing, as later releases do under `--no-env-resolution`, is no evidence either way."""
    kept = {"env_file": [{"path": "/render/fl_backend/.env", "required": True}, {"path": "/render/.env", "required": True}]}
    rendered = model(frontend=kept, backend=kept)

    assert len(checker.env_files(rendered, "p")) == 2


def test_an_environment_that_is_no_mapping_refuses():
    """Compose renders `environment` as a mapping; a list is a model written some other way, whose names this cannot read."""
    with pytest.raises(ValueError, match="not its rendered model"):
        checker.env_files(model(frontend={"environment": [f"{checker.STAND_IN_READ}1=fl_frontend/.env"]}, backend={}), "p")


def test_a_connector_without_one_static_address_refuses():
    """The daemon's own assignment differs per host, so an unpinned connector has no address to compare."""
    for networks in ({"frankfurtleague-net": None}, {}):
        try:
            checker.connector_address(model(cloudflared={"networks": networks}), "p")
        except ValueError:
            continue
        raise AssertionError(f"a connector with networks {networks!r} was given an address")


# --- who shares a network with whom ---------------------------------------------------------------------

SPLIT: Final = {
    "cloudflared": CONNECTED,
    "nginx": joined(EDGE, APP),
    "frontend": joined(APP),
    "backend": joined(APP),
    "mongo": joined(APP),
}


@pytest.mark.parametrize(
    ("service", "networks"),
    [
        ("cloudflared", (EDGE, APP)),
        ("frontend", (EDGE, APP)),
        ("backend", (EDGE,)),
        ("mongo", (EDGE,)),
        ("nginx", (EDGE,)),
    ],
    ids=[
        "connector-reaches-the-application",
        "frontend-on-the-edge",
        "backend-moved-to-the-edge",
        "database-on-the-edge",
        "edge-cut-off",
    ],
)
def test_a_service_on_another_network_than_its_own_fails(service: str, networks: tuple[str, ...]):
    """Each is a way to the application pair that skips nginx, or an edge cut off from one side."""
    found = checker.networks(model(**(SPLIT | {service: joined(*networks)})), "p")

    assert [finding.detail.split("\n")[0] for finding in found] == [
        f"p: {service} joins {sorted(networks)}, not {sorted(checker.SERVICE_NETWORKS[service])}"
    ]


def test_a_service_nobody_placed_on_a_network_fails():
    """A new service is a decision about who reaches it, so it is placed in `SERVICE_NETWORKS` rather than admitted by default."""
    found = checker.networks(model(**SPLIT, worker=joined(APP)), "p")

    assert len(found) == 1
    assert "worker is on no list" in found[0].detail


def test_networks_that_are_no_mapping_refuse():
    with pytest.raises(ValueError, match="not its rendered model"):
        checker.networks(model(frontend={"networks": [APP]}), "p")


# --- what each service may do as root -------------------------------------------------------------------

PRIVILEGED: Final = model(**{service: hardened(service) for service in (*checker.PRODUCTION_SERVICES, "mongo")})


@pytest.mark.parametrize(
    ("service", "changed", "said"),
    [
        pytest.param("nginx", {"cap_add": ["CHOWN", "SETUID", "SETGID", "NET_RAW"]}, "nginx adds back", id="edge-keeps-net-raw"),
        pytest.param("nginx", {"cap_drop": []}, "nginx drops nothing", id="edge-drops-nothing"),
        pytest.param("frontend", {"cap_add": ["NET_BIND_SERVICE"]}, "frontend adds back", id="frontend-adds-one"),
        pytest.param("backend", {"cap_drop": ["NET_RAW"]}, "backend drops ['NET_RAW'], not ALL", id="backend-drops-one"),
        pytest.param("cloudflared", {"security_opt": []}, "cloudflared does not set no-new-privileges", id="connector-may-gain"),
        pytest.param("mongo", {"security_opt": ["no-new-privileges:false"]}, "mongo does not set no-new-privileges", id="database-false"),
    ],
)
def test_a_capability_or_a_privilege_left_in_place_fails(service: str, changed: dict[str, Any], said: str):
    """NET_RAW is the one that reads the bridge the admin key and the actor's headers cross in plain HTTP."""
    rendered = model(**PRIVILEGED["services"] | {service: hardened(service) | changed})

    found = checker.privileges(rendered, "p")

    assert [f"p: {said}" in finding.detail for finding in found] == [True], found


# --- which service holds which secret ---------------------------------------------------------------

RENDER: Final = Path("/render")
KEY: Final = "auth_secret"


def stack_of(stack: str, **services: dict[str, Any]) -> dict[str, Any]:
    """Every service of `stack` holding what the table gives it, `services` merged over them."""
    names = {service for holders, _ in checker.SECRET_HOLDERS[stack].values() for service in holders}
    held = {service: holding(stack, service) for service in names}
    return model(**(held | services)) | declared_secrets(RENDER, stack)


# One holder the table leaves out stands for every one: the check compares every secret's holders with its row alike.
@pytest.mark.parametrize(("stack", "secret", "holder"), [pytest.param("production", "auth_secret", "nginx", id="production-auth_secret-nginx")])
def test_a_second_holder_of_any_secret_fails(stack: str, secret: str, holder: str):
    """A second holder of a key holds a credential its table never gave it, the edge's own included."""
    rendered = stack_of(stack)
    rendered["services"][holder] = {"secrets": [*(rendered["services"].get(holder) or {}).get("secrets", []), {"source": secret}]}

    found = checker.secret_holders(rendered, "p", RENDER, stack)

    assert len(found) == 1, found
    assert f"'{holder}'" in found[0].detail and secret in found[0].detail, found


@pytest.mark.parametrize(
    ("secret", "service"),
    [("internal_api_key_admin", "backend")],
)
def test_a_reader_left_without_its_secret_fails(secret: str, service: str):
    """Its boot refuses after the recreate, behind an edge answering 502; a shared key missing on one side refuses every call."""
    rendered = stack_of("production")
    kept = [entry for entry in rendered["services"][service]["secrets"] if entry["source"] != secret]
    rendered["services"][service] = {"secrets": kept}

    found = checker.secret_holders(rendered, "p", RENDER, "production")

    assert len(found) == 1 and f"holds {secret}" in found[0].detail, found


def test_a_secret_mounted_elsewhere_fails():
    """Each reader takes the default path, so a file mounted anywhere else is no file to it."""
    rendered = stack_of("production")
    rendered["services"]["backend"]["secrets"] = [
        entry | {"target": "/etc/key"} if entry["source"] == "internal_api_key_admin" else entry
        for entry in rendered["services"]["backend"]["secrets"]
    ]

    found = checker.secret_holders(rendered, "p", RENDER, "production")

    assert len(found) == 1 and "/etc/key" in found[0].detail, found


def test_a_secret_read_from_another_file_fails():
    """The preflight judges `secrets/<name>`, so another source is a file nothing checked."""
    rendered = stack_of("production") | declared_secrets(RENDER, "production", **{KEY: "keys/auth.txt"})

    found = checker.secret_holders(rendered, "p", RENDER, "production")

    assert len(found) == 1 and "keys/auth.txt" in found[0].detail, found


def test_the_local_stack_reading_a_database_login_from_secrets_fails():
    """The stack's login is its inline config, so no development machine holds production's login to point it at."""
    rendered = stack_of("local") | declared_secrets(RENDER, "local", backend_mongodb_uri="secrets/backend_mongodb_uri")

    found = checker.secret_holders(rendered, "p", RENDER, "local")

    assert [finding.detail for finding in found] == ["p: the secret backend_mongodb_uri is declared and SECRET_HOLDERS lists no such secret"]


# --- which service reads which login from an inline config -------------------------------------------

LOCAL_URI: Final = "mongodb://mongo:27017/?directConnection=true"


def configured(stack: str, service: str) -> dict[str, Any]:
    """A service's configs as Compose renders the long syntax: one per file `CONFIG_HOLDERS` gives it, at `RUN_SECRETS`."""
    held = [
        {"source": "local_mongodb_uri", "target": f"{checker.RUN_SECRETS}/{file}"}
        for file, holders in sorted(checker.CONFIG_HOLDERS[stack].items())
        if service in holders
    ]
    return {"configs": held} if held else {}


def declared_configs(stack: str, content: object = LOCAL_URI) -> dict[str, Any]:
    """The top-level `configs` as Compose renders an inline one; none where the stack's table names none."""
    return {"configs": {"local_mongodb_uri": {"content": content}}} if checker.CONFIG_HOLDERS[stack] else {}


def configured_stack(stack: str, content: object = LOCAL_URI) -> dict[str, Any]:
    """Every service of `stack` reading what `CONFIG_HOLDERS` gives it, beside the stack's own database."""
    names = {service for holders in checker.CONFIG_HOLDERS[stack].values() for service in holders}
    return model(mongo={}, **{service: configured(stack, service) for service in names}) | declared_configs(stack, content)


@pytest.mark.parametrize(
    "content",
    [
        pytest.param("mongodb://cluster0.example.net:27017/", id="another-host"),
        pytest.param("mongodb://user:pass@mongo:27017/", id="a-login"),
        pytest.param("mongodb://mongo:27017,cluster0.example.net:27017/", id="a-second-host"),
        pytest.param("mongodb+srv://mongo/", id="a-lookup"),
        pytest.param(None, id="no-inline-content"),
    ],
)
def test_a_login_config_naming_anything_but_the_stacks_own_database_fails(content: object):
    """Both readers take it for their login, so any other value aims the stack at a database it does not start."""
    found = checker.config_holders(configured_stack("local", content), "p", "local")

    assert len(found) == 2 and all("the config local_mongodb_uri" in finding.detail for finding in found), found


def test_a_login_naming_a_service_the_stack_lacks_fails():
    rendered = configured_stack("local")
    del rendered["services"]["mongo"]

    assert len(checker.config_holders(rendered, "p", "local")) == 2


def test_a_login_config_one_reader_lacks_fails():
    rendered = configured_stack("local")
    rendered["services"]["backend"] = {}

    found = checker.config_holders(rendered, "p", "local")

    assert [finding.detail for finding in found] == ["p: nothing reads a config as backend_mongodb_uri, not ['backend']"]


def test_a_second_reader_of_a_login_config_fails():
    rendered = configured_stack("local")
    rendered["services"]["nginx"] = configured("local", "frontend")

    found = checker.config_holders(rendered, "p", "local")

    assert len(found) == 1 and "['frontend', 'nginx'] reads a config" in found[0].detail, found


def test_a_config_where_a_service_reads_its_credentials_fails_in_production():
    """Production's every login is a secret under `secrets/`, which the preflight asks the host for."""
    rendered = configured_stack("production") | declared_configs("local")
    rendered["services"]["backend"] = configured("local", "backend")

    found = checker.config_holders(rendered, "p", "production")

    assert len(found) == 1 and "a file CONFIG_HOLDERS lacks" in found[0].detail, found


def test_a_secret_the_table_lists_left_undeclared_fails():
    rendered = stack_of("production")
    del rendered["secrets"]["resend_webhook_secret"]

    found = checker.secret_holders(rendered, "p", RENDER, "production")

    assert len(found) == 1 and "resend_webhook_secret is not declared" in found[0].detail, found


def test_the_key_file_under_a_second_secret_name_fails():
    """An alias is the key by another name: every check keyed on the name would pass its holder by."""
    rendered = stack_of("production", backend={"secrets": [*holding("production", "backend")["secrets"], {"source": "copy"}]})
    rendered["secrets"]["copy"] = {"file": str(RENDER / "secrets" / KEY)}

    found = checker.secret_holders(rendered, "p", RENDER, "production")

    assert [finding.detail.split("\n")[0] for finding in found] == ["p: the secret copy is declared and SECRET_HOLDERS lists no such secret"]


# --- the names the secret files replace ----------------------------------------------------------------


@pytest.mark.parametrize("variable", ["MONGODB_URI", "mongodb_uri", "INTERNAL_API_KEY_ADMIN", "AUTH_SECRET"])
def test_a_moved_name_in_an_environment_fails_in_any_case(variable: str):
    """The backend folds case, so the lower-cased copy is the credential again."""
    found = checker.moved_names(model(backend={"environment": {variable: "x"}}), "p")

    assert len(found) == 1 and f"p: backend is handed {variable}" in found[0].detail, found


def _bound(source: Path, target: str = "/mnt/x") -> dict[str, Any]:
    return {"volumes": [{"type": "bind", "source": str(source), "target": target}]}


@pytest.mark.parametrize(
    ("service", "source"),
    [
        pytest.param("backend", RENDER / "secrets", id="the-directory-into-the-backend"),
        pytest.param("nginx", RENDER / "secrets" / KEY, id="the-key-file-into-the-edge"),
        pytest.param("backend", RENDER, id="the-checkout-holding-it"),
    ],
)
def test_a_bind_mount_reaching_the_secrets_directory_fails(service: str, source: Path):
    """A bind is a second route to the key, past the one mount the rule names, and the tunnel token beside it."""
    found = checker.secrets_directory(model(**{service: _bound(source)}), "p", RENDER)

    assert len(found) == 1, found
    assert f"p: {service} bind-mounts" in found[0].detail


def test_a_config_read_from_the_secrets_directory_fails():
    """A config mounts its file into whichever service names it, so it is a bind by another spelling."""
    configs = {"configs": {"leak": {"file": str(RENDER / "secrets" / KEY)}}}

    assert len(checker.secrets_directory(model() | configs, "p", RENDER)) == 1


# --- the models the gate and the edge test render --------------------------------------------------------

LIB: Final = Path(__file__).resolve().parents[1] / "lib" / "_lib.sh"
# Records each compose call's argv, one call per line, and writes nothing a model would hold.
COMPOSE_STUB: Final = '#!/usr/bin/env bash\nprintf \'%s\n\' "$*" >> "$FL_COMPOSE_ARGV"\n'


def _staged_and_rendered() -> tuple[Path, list[str]]:
    """`stage_compose_models` and both renders, as the gate's ops scope calls them, behind a stand-in docker."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root = new_root("fl-compose-stage-")
    stubs = root / "stubs"
    stubs.mkdir()
    os.chmod(write_shell(stubs / "docker", COMPOSE_STUB), 0o755)
    environment = base_env() | {"PATH": str(stubs) + os.pathsep + os.environ["PATH"], "FL_COMPOSE_ARGV": str(root / "argv.txt")}
    staged = root / "staged"
    body = (
        f'source "{LIB.as_posix()}"\n'
        f'stage_compose_models "{staged.as_posix()}"\n'
        f'render_compose_model "{staged.as_posix()}" production\n'
        f'render_compose_model "{staged.as_posix()}" local\n'
    )
    done = run_shell(BASH, write_shell(root / "parent.sh", body), env=environment)
    assert done.returncode == 0, done.stdout + done.stderr
    return staged, (root / "argv.txt").read_text(encoding="utf-8").splitlines()


def test_each_stand_in_names_itself_in_the_names_the_checker_reads():
    """`env_files` judges a service by what its stand-ins resolved to, so a stand-in the checker cannot read judges nothing."""
    staged, _ = _staged_and_rendered()

    for number, env_file in enumerate(("fl_backend/.env", "fl_frontend/.env"), start=1):
        text = (staged / env_file).read_bytes().decode()
        assert text == f"{checker.STAND_IN_READ}{number}={env_file}\n", env_file
    assert (staged / "docker-compose.yml").read_bytes() == (checker.REPO_ROOT / "docker-compose.yml").read_bytes()
    assert (staged / "docker-compose.local.yml").read_bytes() == (checker.REPO_ROOT / "docker-compose.local.yml").read_bytes()


def test_the_local_model_is_the_merge_and_neither_render_skips_the_environment():
    """`--no-env-resolution` is ignored by one Compose release and honoured by the next, so it renders two models."""
    staged, argv = _staged_and_rendered()
    base = f"-f {staged.as_posix()}/docker-compose.yml"

    assert argv == [
        f"compose {base} config --format json --output {staged.as_posix()}/production.json",
        f"compose {base} -f {staged.as_posix()}/docker-compose.local.yml config --format json --output {staged.as_posix()}/local.json",
    ]
