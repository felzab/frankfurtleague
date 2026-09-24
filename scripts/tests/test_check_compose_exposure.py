"""SCRIPTS · the exposure check over rendered Compose models

The models here are written in the long form `docker compose config` renders ports in
(https://docs.docker.com/reference/compose-file/services/#long-syntax-4), so each case pins the
rule rather than either compose file's current wording.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from typing import Any

SCRIPTS = Path(__file__).resolve().parents[1]

# Withdrawn again, kernel dropped from the cache with it: a `checker_kernel` left cached here
# would answer another suite's imports and root it at the wrong repository.
sys.path.insert(0, str(SCRIPTS / "checks"))
try:
    exposure = importlib.import_module("check_compose_exposure")
finally:
    sys.path.remove(str(SCRIPTS / "checks"))
    sys.modules.pop("check_compose_exposure", None)
    sys.modules.pop("checker_kernel", None)


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
