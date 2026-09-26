"""SCRIPTS · the checks over the models Compose renders

The models here are written in the long form `docker compose config` renders ports and volumes in
(https://docs.docker.com/reference/compose-file/services/#long-syntax-4), so each case pins the
rule rather than either compose file's current wording.
"""

from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
from typing import Any

from conftest import import_scripts, new_root

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
    return f"{real_ip}\nreal_ip_header CF-Connecting-IP;\n\ngeo $realip_fallback {{\n    default          0;\n    {arm}\n}}\n"


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
    assert len(checker.trusted_connector(conf() + conf(real_ip=""), CONNECTOR, "c")) == 1


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
    """`set_real_ip_from` adds to the set wherever it is written, a server block included."""
    widened = mounted("server {\n    set_real_ip_from 173.245.48.0/20;\n}\n", conf())

    assert len(checker.trusted_connector(checker.edge_configuration(PAIRS, widened), CONNECTOR, "c")) == 1


def test_a_mounted_directory_the_checkout_lacks_is_left_to_the_mount_check():
    """`edge_mounts` reports it as a finding; reading it here would turn that finding into a refusal."""
    root = mounted("", conf())
    missing = [*PAIRS, ("nginx/absent", "/etc/nginx/absent")]

    assert checker.trusted_connector(checker.edge_configuration(missing, root), CONNECTOR, "c") == []


def env_file(project: Path, *paths: str) -> dict[str, Any]:
    """A service's `env_file` as `--no-env-resolution` leaves it: each entry a mapping, its path absolute."""
    return {"env_file": [{"path": str(project / path), "required": True} for path in paths]}


def rendered_stack(project: Path, conf_dir: str, **extra: dict[str, Any]) -> dict[str, Any]:
    """A stack as the gate renders it beside `project`, its edge mounting `conf_dir` and `nginx/shared` of this checkout."""
    edge_volumes = [
        {"type": "bind", "source": str(project / conf_dir), "target": "/etc/nginx/conf.d"},
        {"type": "bind", "source": str(project / "nginx/shared"), "target": "/etc/nginx/shared"},
    ]
    nginx = {"volumes": edge_volumes, "command": LISTENING, "tmpfs": ["/run/nginx-control:mode=700"]}
    frontend = env_file(project, "fl_frontend/.env", ".env")
    backend = env_file(project, "fl_backend/.env", ".env")
    return model(nginx=nginx, frontend=frontend, backend=backend, **extra)


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
    connector = {"networks": {"frankfurtleague-net": {"ipv4_address": CONNECTOR}}}
    production = rendered_stack(project, "nginx/prod", cloudflared=connector)
    local = rendered_stack(project, "nginx/local")

    code, said = run_main(production, local, project)

    assert code == 0, said


def test_main_judges_the_environment_files_of_both_models():
    """The rule's own cases drive it directly; a service reading its package's file alone, in either model, fails the run."""
    project = new_root("fl-compose-main-env-")
    connector = {"networks": {"frankfurtleague-net": {"ipv4_address": CONNECTOR}}}
    for broken in ("production", "local"):
        production = rendered_stack(project, "nginx/prod", cloudflared=connector)
        local = rendered_stack(project, "nginx/local")
        ({"production": production, "local": local}[broken])["services"]["backend"] = env_file(project, "fl_backend/.env")

        code, said = run_main(production, local, project)

        assert code == 1, said
        assert f"{broken}: backend reads env_file" in said, said


# --- the environment files each application service reads ---------------------------------------------


def test_each_service_reading_its_package_file_then_the_checkouts_is_clean():
    project = Path("/render")
    rendered = model(frontend=env_file(project, "fl_frontend/.env", ".env"), backend=env_file(project, "fl_backend/.env", ".env"))

    assert checker.env_files(rendered, "p", project) == []


def test_the_checkouts_file_listed_first_fails():
    """Compose would then hand a name both carry the package's value, and the deploy's readers judge the other."""
    project = Path("/render")
    rendered = model(frontend=env_file(project, ".env", "fl_frontend/.env"), backend=env_file(project, "fl_backend/.env", ".env"))

    assert len(checker.env_files(rendered, "p", project)) == 1


def test_a_service_without_the_checkouts_file_fails():
    """Its container starts without the keys the deploy's reader found in the union, and the boot gate refuses after the recreate."""
    project = Path("/render")
    rendered = model(frontend=env_file(project, "fl_frontend/.env", ".env"), backend=env_file(project, "fl_backend/.env"))

    assert len(checker.env_files(rendered, "p", project)) == 1


def test_an_entry_that_is_no_path_refuses():
    try:
        checker.env_files(model(frontend={"env_file": [{"required": True}]}, backend={}), "p", Path("/render"))
    except ValueError:
        return
    raise AssertionError("an env_file entry carrying no path was judged")


def test_a_connector_without_one_static_address_refuses():
    """The daemon's own assignment differs per host, so an unpinned connector has no address to compare."""
    for networks in ({"frankfurtleague-net": None}, {}):
        try:
            checker.connector_address(model(cloudflared={"networks": networks}), "p")
        except ValueError:
            continue
        raise AssertionError(f"a connector with networks {networks!r} was given an address")
