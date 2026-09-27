"""SCRIPTS · the checks over the models Compose renders

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
from conftest import BASH, base_env, import_scripts, lift_assignment, new_root, run_shell, write_shell

[checker] = import_scripts("check_compose_model")


def model(**services: dict[str, Any]) -> dict[str, Any]:
    return {"services": services}


def port(published: str, target: int, host_ip: str | None = None) -> dict[str, Any]:
    rendered: dict[str, Any] = {"mode": "ingress", "target": target, "published": published, "protocol": "tcp"}
    if host_ip is not None:
        rendered["host_ip"] = host_ip
    return rendered


PRODUCTION = model(frontend={}, backend={}, nginx={}, cloudflared={})


def test_the_production_shape_is_clean():
    assert checker.production(PRODUCTION, "p") == []


def test_a_database_joining_production_fails():
    """I174: the pinned set is what a `mongo` service breaks."""
    assert len(checker.production(model(**PRODUCTION["services"], mongo={}), "p")) == 1


def test_any_production_port_fails_the_edge_included():
    """`docs/ops/spec.md` I1: production's nginx publishes nothing either; the connector reaches it over the network."""
    found = checker.production(model(frontend={}, backend={}, nginx={"ports": [port("443", 443)]}, cloudflared={}), "p")
    assert len(found) == 1


def test_host_networking_fails_although_it_declares_no_port():
    found = checker.production(model(frontend={"network_mode": "host"}, backend={}, nginx={}, cloudflared={}), "p")
    assert len(found) == 1


def test_locally_the_edge_may_publish_to_every_interface():
    assert checker.local(model(nginx={"ports": [port("3000", 80)]}), "l") == []


def test_locally_a_database_on_loopback_is_clean_on_either_family():
    assert checker.local(model(mongo={"ports": [port("27017", 27017, "127.0.0.1"), port("27018", 27017, "::1")]}), "l") == []


def test_locally_a_database_on_every_interface_fails():
    assert len(checker.local(model(mongo={"ports": [port("27017", 27017)]}), "l")) == 1


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


def test_directory_mounts_are_clean_and_read_as_pairs():
    """The log mount's source sits outside the project and a tmpfs is no bind, so neither is a pair."""
    rendered = edge(
        *DIRECTORIES,
        bind("certs", "/etc/nginx/certs"),
        {"type": "bind", "source": "/var/log/x", "target": "/var/log/x"},
        {"type": "tmpfs", "target": "/run/x"},
    )
    pairs, findings = checker.edge_mounts(rendered, "p", PROJECT, checkout())

    assert findings == []
    assert pairs == [("nginx/prod", "/etc/nginx/conf.d"), ("nginx/shared", "/etc/nginx/shared")]


def test_a_single_file_mount_fails_whichever_syntax_wrote_it():
    """The rendered model is the same for `./nginx/prod/prod.conf:...` and a long-syntax `source:`, which is why it is read here."""
    rendered = edge(bind("nginx/prod/prod.conf", "/etc/nginx/conf.d/default.conf"), DIRECTORIES[1])
    _, findings = checker.edge_mounts(rendered, "p", PROJECT, checkout())

    assert len(findings) == 1
    assert "nginx/prod/prod.conf" in findings[0].detail


def test_an_edge_mounting_nothing_from_the_checkout_fails():
    _, findings = checker.edge_mounts(edge(bind("certs", "/etc/nginx/certs")), "p", PROJECT, checkout())

    assert len(findings) == 1


def test_a_short_syntax_volume_refuses():
    try:
        checker.edge_mounts(model(nginx={"volumes": ["./nginx/prod:/etc/nginx/conf.d:ro"]}), "p", PROJECT, checkout())
    except ValueError:
        return
    raise AssertionError("a short-syntax volume was judged")


# --- the edge's Control API socket ---------------------------------------------------------------

SOCKET = "/run/nginx-control/control.sock"


def started(command: list[str], tmpfs: list[str]) -> dict[str, Any]:
    return model(nginx={"command": command, "tmpfs": tmpfs})


LISTENING = ["nginx", "-g", "daemon off;", "-l", f"unix:{SOCKET}"]


def test_a_socket_the_deploy_asks_in_a_root_only_tmpfs_is_clean():
    assert checker.control_socket(started(LISTENING, ["/run/nginx-control:mode=700"]), "p", SOCKET) == []


def test_a_command_without_the_listener_or_on_another_socket_fails():
    """Either way every reload the deploy sends meets no socket."""
    tmpfs = ["/run/nginx-control:mode=700"]
    assert len(checker.control_socket(started(LISTENING[:3], tmpfs), "p", SOCKET)) == 1
    assert len(checker.control_socket(started([*LISTENING[:4], "unix:/run/nginx-control/other.sock"], tmpfs), "p", SOCKET)) == 1


def test_a_tmpfs_at_dockers_default_mode_fails():
    """1777, which lets the worker's user into the directory."""
    assert len(checker.control_socket(started(LISTENING, ["/run/nginx-control"]), "p", SOCKET)) == 1


def test_the_socket_is_read_off_the_deploy_script():
    assert checker.deploy_socket(checker.DEPLOY) == SOCKET


def test_the_deploy_compares_exactly_the_pairs_production_mounts():
    """Read off the script itself: a pair missing there is a directory nginx loads and no deploy compares."""
    pairs = [("nginx/prod", "/etc/nginx/conf.d"), ("nginx/shared", "/etc/nginx/shared")]

    assert checker.compared(pairs, checker.deploy_pairs(checker.DEPLOY), "p") == []
    assert len(checker.compared([*pairs, ("nginx/extra", "/etc/nginx/extra")], checker.deploy_pairs(checker.DEPLOY), "p")) == 1


# --- the connector production's edge trusts ---------------------------------------------------------

CONNECTOR = "172.30.0.250"


def conf(real_ip: str = f"set_real_ip_from {CONNECTOR};", arm: str = f"{CONNECTOR}/32  1;") -> str:
    """An edge's trust, as `nginx/shared/http.conf` spells it."""
    return f"{real_ip}\nreal_ip_header CF-Connecting-IP;\nreal_ip_recursive off;\n\n{marker(arm)}"


def marker(arm: str = f"{CONNECTOR}/32  1;") -> str:
    """The fallback's geo block alone."""
    return f"geo $realip_fallback {{\n    default          0;\n    {arm}\n}}\n"


@pytest.mark.parametrize(
    "added",
    ["server {\n    real_ip_header X-Forwarded-For;\n}\n", "location / {\n    real_ip_recursive on;\n}\n"],
    ids=["header", "recursive"],
)
def test_a_realip_setting_a_server_or_location_overrides_fails(added: str):
    """nginx takes a level's own setting over the inherited one, so a server reading another header trusts what a client writes there."""
    assert len(checker.trusted_connector(conf() + added, CONNECTOR, "c")) == 1


@pytest.mark.parametrize(
    "statement",
    ["set_real_ip_from 0.0.0.0/0;", "real_ip_header X-Forwarded-For;", "real_ip_recursive on;"],
    ids=["trust", "header", "recursive"],
)
def test_a_realip_directive_inside_a_one_line_block_fails(statement: str):
    """nginx reads statements, not lines: a directive after the `{` on the block's own line takes effect all the same."""
    one_line = f"location = /probe {{ {statement} return 204; }}\n"

    assert len(checker.trusted_connector(conf() + one_line, CONNECTOR, "c")) == 1


def test_a_realip_directive_commented_out_or_quoted_is_no_statement():
    """A `#` comment is nothing to nginx, and a quoted `;` or brace is data inside one value."""
    inert = '# set_real_ip_from 0.0.0.0/0;\nlog_format probe "{ set_real_ip_from 0.0.0.0/0; }";\n'

    assert checker.trusted_connector(conf() + inert, CONNECTOR, "c") == []


def test_a_one_line_geo_block_marking_another_address_fails():
    assert len(checker.trusted_connector(conf() + "geo $realip_fallback { default 0; 10.0.0.1/32 1; }\n", CONNECTOR, "c")) == 1


def test_a_realip_header_declared_nowhere_fails():
    """nginx's default is X-Real-IP, which the connector never sends, so every visitor would read as the connector."""
    assert len(checker.trusted_connector(conf().replace("real_ip_header CF-Connecting-IP;\n", ""), CONNECTOR, "c")) == 1


def test_a_connector_trusted_and_marked_at_its_rendered_address_is_clean():
    rendered = model(cloudflared={"networks": {"frankfurtleague-net": {"ipv4_address": CONNECTOR}}})

    assert checker.trusted_connector(conf(), checker.connector_address(rendered, "p"), "c") == []


def test_trust_moved_off_the_connector_fails():
    """Every visitor is then keyed to the connector's own address, one rate-limit bucket for the site."""
    assert len(checker.trusted_connector(conf(real_ip="set_real_ip_from 172.30.0.251;"), CONNECTOR, "c")) == 1


def test_trust_widened_beside_the_connector_fails():
    """A second range lets any host inside it name the visitor."""
    widened = conf(real_ip=f"set_real_ip_from {CONNECTOR};\nset_real_ip_from 173.245.48.0/20;")

    assert len(checker.trusted_connector(widened, CONNECTOR, "c")) == 1


def test_a_fallback_marker_at_another_address_fails():
    """A marker nothing matches leaves the access line silent about the fallback it exists to show."""
    assert len(checker.trusted_connector(conf(arm="172.30.0.2/32  1;"), CONNECTOR, "c")) == 1


def test_a_conf_without_the_fallback_marker_refuses():
    try:
        checker.trusted_connector(f"set_real_ip_from {CONNECTOR};\n", CONNECTOR, "c")
    except ValueError:
        return
    raise AssertionError("a configuration with no geo block was judged")


def test_a_second_fallback_marker_fails():
    """Each file an edge mounts is read, so a block an entry file repeats is a second marker, not a hidden one."""
    assert len(checker.trusted_connector(conf() + marker(), CONNECTOR, "c")) == 1


def mounted(prod: str, shared: str) -> Path:
    """A checkout whose two mounted directories hold one file each."""
    root = new_root("fl-compose-trust-")
    for directory, text in (("nginx/prod", prod), ("nginx/shared", shared)):
        (root / directory).mkdir(parents=True)
        (root / directory / "edge.conf").write_bytes(text.encode())
    return root


PAIRS = [("nginx/prod", "/etc/nginx/conf.d"), ("nginx/shared", "/etc/nginx/shared")]


def test_trust_in_the_shared_file_reaches_the_edge_mounting_it():
    assert checker.trusted_connector(checker.edge_configuration(PAIRS, mounted("", conf())), CONNECTOR, "c") == []


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
    """A service's environment as Compose resolves it from the gate's stand-ins for `paths`, read in that order.

    Each stand-in's own name is suffixed by its position here; the checker reads only the values.
    """
    environment: dict[str, str] = {}
    for position, path in enumerate(paths, start=1):
        environment[f"{checker.STAND_IN_READ}{position}"] = path
        environment[checker.STAND_IN_LAST] = path
    return {"environment": environment}


def rendered_stack(project: Path, conf_dir: str, **extra: dict[str, Any]) -> dict[str, Any]:
    """A stack as the gate renders it beside `project`, its edge mounting `conf_dir` and `nginx/shared` of this checkout.

    `nginx/local` is the local stack's edge, and the stack's secrets follow from it.
    """
    stack_name = "local" if conf_dir == "nginx/local" else "production"
    edge_volumes = [
        {"type": "bind", "source": str(project / conf_dir), "target": "/etc/nginx/conf.d"},
        {"type": "bind", "source": str(project / "nginx/shared"), "target": "/etc/nginx/shared"},
    ]
    nginx = {"volumes": edge_volumes, "command": LISTENING, "tmpfs": ["/run/nginx-control:mode=700"], **joined(EDGE, APP)}
    frontend = env_file("fl_frontend/.env", ".env") | joined(APP)
    backend = env_file("fl_backend/.env", ".env") | joined(APP)
    stack = {"nginx": nginx, "frontend": frontend, "backend": backend, **extra}
    rendered = {service: definition | hardened(service) | holding(stack_name, service) for service, definition in stack.items()}
    return model(**rendered) | declared_secrets(project, stack_name)


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


def run_main(production: dict[str, Any], local: dict[str, Any], project: Path) -> tuple[int, str]:
    """`main` over two rendered models: its exit code and what it printed, as `test_check_gate_budget.py :: run_main` drives its own."""
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


def test_both_edges_of_this_checkout_are_judged_and_trust_the_connector_alone():
    """The nginx files as they stand, through `main`: a trust either edge's own directory adds fails this."""
    project = new_root("fl-compose-main-")

    production = rendered_stack(project, "nginx/prod", cloudflared=CONNECTED)
    local = rendered_stack(project, "nginx/local")

    code, said = run_main(production, local, project)

    assert code == 0, said


def test_main_judges_the_environment_files_of_both_models():
    """The rule's own cases drive it directly; a service reading its package's file alone, in either model, fails the run."""
    project = new_root("fl-compose-main-env-")

    for broken in ("production", "local"):
        production = rendered_stack(project, "nginx/prod", cloudflared=CONNECTED)
        local = rendered_stack(project, "nginx/local")
        ({"production": production, "local": local}[broken])["services"]["backend"] = env_file("fl_backend/.env") | joined(APP)

        code, said = run_main(production, local, project)

        assert code == 1, said
        assert f"{broken}: backend reads the environment files" in said, said


# --- the environment files each application service reads ---------------------------------------------


def test_each_service_reading_its_package_file_then_the_checkouts_is_clean():
    rendered = model(frontend=env_file("fl_frontend/.env", ".env"), backend=env_file("fl_backend/.env", ".env"))

    assert checker.env_files(rendered, "p") == []


def test_the_checkouts_file_listed_first_fails():
    """Compose would then hand a name both carry the package's value, and the deploy's readers judge the other."""
    rendered = model(frontend=env_file(".env", "fl_frontend/.env"), backend=env_file("fl_backend/.env", ".env"))

    assert len(checker.env_files(rendered, "p")) == 1


def test_a_service_without_the_checkouts_file_fails():
    """Its container starts without the keys the deploy's reader found in the union, and the boot gate refuses after the recreate."""
    rendered = model(frontend=env_file("fl_frontend/.env", ".env"), backend=env_file("fl_backend/.env"))

    assert len(checker.env_files(rendered, "p")) == 1


def test_a_third_file_between_the_two_fails():
    """The root's still read last, so only the count of files read catches the one the deploy never joins."""
    rendered = model(frontend=env_file("fl_frontend/.env", "fl_backend/.env", ".env"), backend=env_file("fl_backend/.env", ".env"))

    assert len(checker.env_files(rendered, "p")) == 1


def test_a_model_whose_environment_compose_left_unresolved_fails():
    """A render keeping `env_file` and resolving nothing, as later releases do under `--no-env-resolution`, is no evidence either way."""
    kept = {"env_file": [{"path": "/render/fl_backend/.env", "required": True}, {"path": "/render/.env", "required": True}]}
    rendered = model(frontend=kept, backend=kept)

    assert len(checker.env_files(rendered, "p")) == 2


def test_an_environment_that_is_no_mapping_refuses():
    """Compose renders `environment` as a mapping; a list is a model written some other way, whose names this cannot read."""
    with pytest.raises(ValueError, match="not its rendered model"):
        checker.env_files(model(frontend={"environment": [f"{checker.STAND_IN_LAST}=.env"]}, backend={}), "p")


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


def test_each_service_on_exactly_its_networks_is_clean():
    assert checker.networks(model(**SPLIT), "p") == []


@pytest.mark.parametrize(
    ("service", "networks"),
    [
        ("cloudflared", (EDGE, APP)),
        ("frontend", (EDGE, APP)),
        ("backend", (EDGE,)),
        ("mongo", (EDGE,)),
        ("nginx", (EDGE,)),
        ("backend", ("default",)),
    ],
    ids=[
        "connector-reaches-the-application",
        "frontend-on-the-edge",
        "backend-moved-to-the-edge",
        "database-on-the-edge",
        "edge-cut-off",
        "default",
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


def test_main_judges_the_networks_of_both_models():
    """A frontend joining the edge network, in either model, fails the run."""
    project = new_root("fl-compose-main-networks-")
    for broken in ("production", "local"):
        production = rendered_stack(project, "nginx/prod", cloudflared=CONNECTED)
        local = rendered_stack(project, "nginx/local")
        ({"production": production, "local": local}[broken])["services"]["frontend"] |= joined(EDGE, APP)

        code, said = run_main(production, local, project)

        assert code == 1, said
        assert f"{broken}: frontend joins" in said, said


# --- what each service may do as root -------------------------------------------------------------------

PRIVILEGED: Final = model(**{service: hardened(service) for service in (*checker.PRODUCTION_SERVICES, "mongo")})


def test_every_service_dropping_all_and_the_edge_adding_its_four_is_clean():
    assert checker.privileges(PRIVILEGED, "p") == []


@pytest.mark.parametrize(
    "spelled", [["cap_chown", "Cap_SetUid", "SETGID", "dac_override"], ["CAP_CHOWN", "CAP_SETUID", "CAP_SETGID", "CAP_DAC_OVERRIDE"]]
)
def test_a_capability_spelled_as_docker_also_accepts_it_is_the_same_capability(spelled: list[str]):
    """Docker takes a name in any case and with or without `CAP_`, so a spelling alone is no finding."""
    rendered = model(**PRIVILEGED["services"] | {"nginx": hardened("nginx") | {"cap_add": spelled}})

    assert checker.privileges(rendered, "p") == []


@pytest.mark.parametrize(
    ("service", "changed", "said"),
    [
        pytest.param(
            "nginx", {"cap_add": ["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE", "NET_RAW"]}, "nginx adds back", id="edge-keeps-net-raw"
        ),
        pytest.param("nginx", {"cap_drop": []}, "nginx drops nothing", id="edge-drops-nothing"),
        pytest.param("frontend", {"cap_add": ["NET_BIND_SERVICE"]}, "frontend adds back", id="frontend-adds-one"),
        pytest.param("backend", {"cap_drop": ["NET_RAW"]}, "backend drops ['NET_RAW'], not ALL", id="backend-drops-one"),
        pytest.param("cloudflared", {"security_opt": []}, "cloudflared does not set no-new-privileges", id="connector-may-gain"),
        pytest.param("mongo", {"security_opt": ["no-new-privileges:false"]}, "mongo does not set no-new-privileges", id="database-false"),
    ],
)
def test_a_capability_or_a_privilege_left_in_place_fails(service: str, changed: dict[str, Any], said: str):
    """NET_RAW is the one that reads the bridge the admin key and an actor token cross in plain HTTP."""
    rendered = model(**PRIVILEGED["services"] | {service: hardened(service) | changed})

    found = checker.privileges(rendered, "p")

    assert [f"p: {said}" in finding.detail for finding in found] == [True], found


def test_main_judges_the_privileges_of_both_models():
    project = new_root("fl-compose-main-privileges-")
    for broken in ("production", "local"):
        production = rendered_stack(project, "nginx/prod", cloudflared=CONNECTED)
        local = rendered_stack(project, "nginx/local")
        ({"production": production, "local": local}[broken])["services"]["nginx"]["cap_add"] = ["ALL"]

        code, said = run_main(production, local, project)

        assert code == 1, said
        assert f"{broken}: nginx adds back ['ALL']" in said, said


# --- which service holds which secret ---------------------------------------------------------------

RENDER: Final = Path("/render")
KEY: Final = "fl_actor_signing_key"


def stack_of(stack: str, **services: dict[str, Any]) -> dict[str, Any]:
    """Every service of `stack` holding what the table gives it, `services` merged over them."""
    names = {service for holders, _ in checker.SECRET_HOLDERS[stack].values() for service in holders}
    held = {service: holding(stack, service) for service in names}
    return model(**(held | services)) | declared_secrets(RENDER, stack)


@pytest.mark.parametrize("stack", ["production", "local"])
def test_each_stack_holding_exactly_its_table_is_clean(stack: str):
    assert checker.secret_holders(stack_of(stack), "p", RENDER, stack) == []


@pytest.mark.parametrize("target", [KEY, f"/run/secrets/{KEY}"], ids=["relative", "absolute"])
def test_a_target_naming_the_default_path_either_way_is_clean(target: str):
    frontend = holding("production", "frontend")["secrets"]
    moved = [entry | {"target": target} if entry["source"] == KEY else entry for entry in frontend]

    assert checker.secret_holders(stack_of("production", frontend={"secrets": moved}), "p", RENDER, "production") == []


@pytest.mark.parametrize("holder", ["backend", "nginx", "cloudflared"])
def test_a_second_holder_of_the_signing_key_fails(holder: str):
    """Whoever holds the key mints an actor the backend takes as the frontend's."""
    rendered = stack_of("production")
    rendered["services"][holder] = {"secrets": [*(rendered["services"].get(holder) or {}).get("secrets", []), {"source": KEY}]}

    found = checker.secret_holders(rendered, "p", RENDER, "production")

    assert len(found) == 1, found
    assert f"'{holder}'" in found[0].detail and KEY in found[0].detail, found


@pytest.mark.parametrize(
    ("secret", "service"),
    [(KEY, "frontend"), ("auth_resend_key", "frontend"), ("internal_api_key_admin", "backend"), ("tunnel_token", "cloudflared")],
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
        entry | {"target": "/etc/key"} if entry["source"] == "sperrliste_schluessel" else entry
        for entry in rendered["services"]["backend"]["secrets"]
    ]

    found = checker.secret_holders(rendered, "p", RENDER, "production")

    assert len(found) == 1 and "/etc/key" in found[0].detail, found


def test_a_secret_read_from_another_file_fails():
    """The preflight judges `secrets/<name>`, so another source is a file nothing checked."""
    rendered = stack_of("production") | declared_secrets(RENDER, "production", **{KEY: "keys/signing.pem"})

    found = checker.secret_holders(rendered, "p", RENDER, "production")

    assert len(found) == 1 and "keys/signing.pem" in found[0].detail, found


def test_the_local_stack_reading_a_database_login_from_secrets_fails():
    """The stack's URI is the tracked one, so no development machine holds production's login to point it at."""
    rendered = stack_of("local") | declared_secrets(RENDER, "local", backend_mongodb_uri="secrets/backend_mongodb_uri")

    found = checker.secret_holders(rendered, "p", RENDER, "local")

    assert len(found) == 1 and checker.LOCAL_DATABASE_URI in found[0].detail, found


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

    assert [finding.detail.split("\n")[0] for finding in found] == [
        "p: the secret copy is declared and SECRET_HOLDERS lists no such secret (I508)"
    ]


def test_main_judges_the_secret_holders_of_both_models():
    project = new_root("fl-compose-main-key-")
    for broken in ("production", "local"):
        production = rendered_stack(project, "nginx/prod", cloudflared=CONNECTED)
        local = rendered_stack(project, "nginx/local")
        ({"production": production, "local": local}[broken])["services"]["backend"]["secrets"].append({"source": KEY})

        code, said = run_main(production, local, project)

        assert code == 1, said
        assert f"{broken}: ['backend', 'frontend'] holds {KEY}" in said, said


def test_the_preflights_lists_are_the_tables():
    """The preflights ask the host for each file compose mounts, so a list apart from compose's asks for the wrong set."""
    lib = Path(__file__).resolve().parents[1] / "lib" / "_lib.sh"

    def listed(name: str) -> set[str]:
        return set(lift_assignment(lib, name).split("=", 1)[1].strip("()").split())

    def read_by(stack: str, service: str) -> set[str]:
        return {secret for secret, (holders, _) in checker.SECRET_HOLDERS[stack].items() if service in holders} - {KEY}

    assert listed("FRONTEND_SECRETS") == read_by("production", "frontend")
    assert listed("BACKEND_SECRETS") == read_by("production", "backend") == read_by("local", "backend")
    assert listed("LOCAL_FRONTEND_SECRETS") == read_by("local", "frontend")
    assert listed("MOVED_ENV_NAMES") == checker.MOVED_ENV_NAMES


# --- the names the secret files replace ----------------------------------------------------------------


def test_the_stand_ins_alone_in_an_environment_are_clean():
    rendered = model(
        frontend=env_file("fl_frontend/.env", ".env"), backend=env_file("fl_backend/.env", ".env") | {"environment": {"LOG_FORMAT": "json"}}
    )

    assert checker.moved_names(rendered, "p") == []


@pytest.mark.parametrize("variable", ["MONGODB_URI", "mongodb_uri", "INTERNAL_API_KEY_ADMIN", "AUTH_SECRET"])
def test_a_moved_name_in_an_environment_fails_in_any_case(variable: str):
    """The backend folds case, so the lower-cased copy is the credential again."""
    found = checker.moved_names(model(backend={"environment": {variable: "x"}}), "p")

    assert len(found) == 1 and f"p: backend is handed {variable}" in found[0].detail, found


def test_main_judges_the_moved_names_of_both_models():
    project = new_root("fl-compose-main-moved-")
    for broken in ("production", "local"):
        production = rendered_stack(project, "nginx/prod", cloudflared=CONNECTED)
        local = rendered_stack(project, "nginx/local")
        ({"production": production, "local": local}[broken])["services"]["frontend"]["environment"]["MONGODB_URI"] = "x"

        code, said = run_main(production, local, project)

        assert code == 1, said
        assert f"{broken}: frontend is handed MONGODB_URI" in said, said


def _bound(source: Path, target: str = "/mnt/x") -> dict[str, Any]:
    return {"volumes": [{"type": "bind", "source": str(source), "target": target}]}


@pytest.mark.parametrize(
    ("service", "source"),
    [
        pytest.param("backend", RENDER / "secrets", id="the-directory-into-the-backend"),
        pytest.param("nginx", RENDER / "secrets" / KEY, id="the-key-file-into-the-edge"),
        pytest.param("backend", RENDER, id="the-checkout-holding-it"),
        pytest.param("frontend", RENDER / "secrets", id="the-directory-into-the-frontend-beside-its-secret"),
    ],
)
def test_a_bind_mount_reaching_the_secrets_directory_fails(service: str, source: Path):
    """A bind is a second route to the key, past the one mount I472 names, and the tunnel token beside it."""
    found = checker.secrets_directory(model(**{service: _bound(source)}), "p", RENDER)

    assert len(found) == 1, found
    assert f"p: {service} bind-mounts" in found[0].detail


def test_a_bind_mount_beside_the_secrets_directory_and_a_named_volume_are_clean():
    """`nginx/prod` shares the checkout with `secrets/` and reaches none of it; a named volume is no host path."""
    assert (
        checker.secrets_directory(
            model(nginx=_bound(RENDER / "nginx/prod"), mongo={"volumes": [{"type": "volume", "source": "mongo-data", "target": "/data/db"}]}),
            "p",
            RENDER,
        )
        == []
    )


def test_a_config_read_from_the_secrets_directory_fails():
    """A config mounts its file into whichever service names it, so it is a bind by another spelling."""
    configs = {"configs": {"leak": {"file": str(RENDER / "secrets" / KEY)}}}

    assert len(checker.secrets_directory(model() | configs, "p", RENDER)) == 1


def test_main_judges_the_secrets_directory_of_both_models():
    project = new_root("fl-compose-main-secrets-")
    for broken in ("production", "local"):
        production = rendered_stack(project, "nginx/prod", cloudflared=CONNECTED)
        local = rendered_stack(project, "nginx/local")
        ({"production": production, "local": local}[broken])["services"]["backend"] |= _bound(project / "secrets")

        code, said = run_main(production, local, project)

        assert code == 1, said
        assert f"{broken}: backend bind-mounts" in said, said


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

    for number, env_file in enumerate(("fl_backend/.env", "fl_frontend/.env", ".env"), start=1):
        text = (staged / env_file).read_bytes().decode()
        assert text == f"{checker.STAND_IN_READ}{number}={env_file}\n{checker.STAND_IN_LAST}={env_file}\n", env_file
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
