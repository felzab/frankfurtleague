"""SCRIPTS · the exposure and edge-mount checks over rendered Compose models

The models here are written in the long form `docker compose config` renders ports and volumes in
(https://docs.docker.com/reference/compose-file/services/#long-syntax-4), so each case pins the
rule rather than either compose file's current wording.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from conftest import import_scripts, new_root

[exposure] = import_scripts("check_compose_exposure")


def model(**services: dict[str, Any]) -> dict[str, Any]:
    return {"services": services}


def port(published: str, target: int, host_ip: str | None = None) -> dict[str, Any]:
    rendered: dict[str, Any] = {"mode": "ingress", "target": target, "published": published, "protocol": "tcp"}
    if host_ip is not None:
        rendered["host_ip"] = host_ip
    return rendered


PRODUCTION = model(frontend={}, backend={}, nginx={}, cloudflared={})


def test_the_production_shape_is_clean():
    assert exposure.production(PRODUCTION, "p") == []


def test_a_database_joining_production_fails():
    """I174: the pinned set is what a `mongo` service breaks."""
    assert len(exposure.production(model(**PRODUCTION["services"], mongo={}), "p")) == 1


def test_any_production_port_fails_the_edge_included():
    """`docs/ops/spec.md` I1: production's nginx publishes nothing either; the connector reaches it over the network."""
    found = exposure.production(model(frontend={}, backend={}, nginx={"ports": [port("443", 443)]}, cloudflared={}), "p")
    assert len(found) == 1


def test_host_networking_fails_although_it_declares_no_port():
    found = exposure.production(model(frontend={"network_mode": "host"}, backend={}, nginx={}, cloudflared={}), "p")
    assert len(found) == 1


def test_locally_the_edge_may_publish_to_every_interface():
    assert exposure.local(model(nginx={"ports": [port("3000", 80)]}), "l") == []


def test_locally_a_database_on_loopback_is_clean_on_either_family():
    assert exposure.local(model(mongo={"ports": [port("27017", 27017, "127.0.0.1"), port("27018", 27017, "::1")]}), "l") == []


def test_locally_a_database_on_every_interface_fails():
    assert len(exposure.local(model(mongo={"ports": [port("27017", 27017)]}), "l")) == 1


def test_a_port_compose_did_not_expand_refuses():
    """A short-syntax string means the input is not a rendered model, which is a refusal, not a pass."""
    try:
        exposure.local(model(mongo={"ports": ["27017:27017"]}), "l")
    except ValueError:
        return
    raise AssertionError("a short-syntax port was judged")


def test_a_document_without_services_refuses():
    try:
        exposure.production({"name": "x"}, "p")
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
    pairs, findings = exposure.edge_mounts(rendered, "p", PROJECT, checkout())

    assert findings == []
    assert pairs == [("nginx/prod", "/etc/nginx/conf.d"), ("nginx/shared", "/etc/nginx/shared")]


def test_a_single_file_mount_fails_whichever_syntax_wrote_it():
    """The rendered model is the same for `./nginx/prod/prod.conf:...` and a long-syntax `source:`, which is why it is read here."""
    rendered = edge(bind("nginx/prod/prod.conf", "/etc/nginx/conf.d/default.conf"), DIRECTORIES[1])
    _, findings = exposure.edge_mounts(rendered, "p", PROJECT, checkout())

    assert len(findings) == 1
    assert "nginx/prod/prod.conf" in findings[0].detail


def test_an_edge_mounting_nothing_from_the_checkout_fails():
    _, findings = exposure.edge_mounts(edge(bind("certs", "/etc/nginx/certs")), "p", PROJECT, checkout())

    assert len(findings) == 1


def test_a_short_syntax_volume_refuses():
    try:
        exposure.edge_mounts(model(nginx={"volumes": ["./nginx/prod:/etc/nginx/conf.d:ro"]}), "p", PROJECT, checkout())
    except ValueError:
        return
    raise AssertionError("a short-syntax volume was judged")


# --- the edge's Control API socket ---------------------------------------------------------------

SOCKET = "/run/nginx-control/control.sock"


def started(command: list[str], tmpfs: list[str]) -> dict[str, Any]:
    return model(nginx={"command": command, "tmpfs": tmpfs})


LISTENING = ["nginx", "-g", "daemon off;", "-l", f"unix:{SOCKET}"]


def test_a_socket_the_deploy_asks_in_a_root_only_tmpfs_is_clean():
    assert exposure.control_socket(started(LISTENING, ["/run/nginx-control:mode=700"]), "p", SOCKET) == []


def test_a_command_without_the_listener_or_on_another_socket_fails():
    """Either way every reload the deploy sends meets no socket."""
    tmpfs = ["/run/nginx-control:mode=700"]
    assert len(exposure.control_socket(started(LISTENING[:3], tmpfs), "p", SOCKET)) == 1
    assert len(exposure.control_socket(started([*LISTENING[:4], "unix:/run/nginx-control/other.sock"], tmpfs), "p", SOCKET)) == 1


def test_a_tmpfs_at_dockers_default_mode_fails():
    """1777, which lets the worker's user into the directory."""
    assert len(exposure.control_socket(started(LISTENING, ["/run/nginx-control"]), "p", SOCKET)) == 1


def test_the_socket_is_read_off_the_deploy_script():
    assert exposure.deploy_socket(exposure.DEPLOY) == SOCKET


def test_the_deploy_compares_exactly_the_pairs_production_mounts():
    """Read off the script itself: a pair missing there is a directory nginx loads and no deploy compares."""
    pairs = [("nginx/prod", "/etc/nginx/conf.d"), ("nginx/shared", "/etc/nginx/shared")]

    assert exposure.compared(pairs, exposure.deploy_pairs(exposure.DEPLOY), "p") == []
    assert len(exposure.compared([*pairs, ("nginx/extra", "/etc/nginx/extra")], exposure.deploy_pairs(exposure.DEPLOY), "p")) == 1
