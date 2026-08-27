"""SCRIPTS · the port half of the compose mirror

`check_compose_mirror.py :: DECLARED_DELTAS` covers a whole service at once, so the comparison never
reads the ports of a service only one file declares. This drives the check that does, which is what
holds `docs/ops/spec.md :: I1` for a service the mirror waves through.

Stdlib only, and `scripts/` is put on the path here because the module under test imports
`checker_kernel` as a sibling rather than as a package.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from typing import Any

SCRIPTS = Path(__file__).resolve().parents[1]

# Withdrawn again, kernel dropped from the cache with it: `test_check_docs.py` runs the gate from
# a throwaway copy of scripts/, and a `checker_kernel` cached here would answer its imports and
# root every check at the wrong repository.
sys.path.insert(0, str(SCRIPTS))
try:
    mirror = importlib.import_module("check_compose_mirror")
finally:
    sys.path.remove(str(SCRIPTS))
    sys.modules.pop("check_compose_mirror", None)
    sys.modules.pop("checker_kernel", None)


def one_service(name: str, ports: list[str]) -> dict[str, Any]:
    """A parsed compose document holding a single service and its published ports."""
    return {"services": {name: {"ports": ports}}}


def test_a_database_bound_to_this_host_raises_nothing():
    """A loopback prefix is what the invariant asks for, so it is not a finding."""
    assert mirror.off_host_ports(one_service("mongo", ["127.0.0.1:27017:27017"]), "local") == []


def test_ipv6_loopback_counts_as_this_host():
    """Docker brackets an address in a port mapping, so the bracketed form is the one to accept."""
    assert mirror.off_host_ports(one_service("mongo", ["[::1]:27017:27017"]), "local") == []


def test_the_edge_may_publish_to_every_interface():
    """nginx is the one service a host outside this one is meant to reach."""
    assert mirror.off_host_ports(one_service(mirror.EDGE_SERVICE, ["80:80", "443:443"]), "prod") == []


def test_any_other_service_publishing_to_every_interface_fails():
    """The regression the wholesale `services.mongo` delta would otherwise hide."""
    findings = mirror.off_host_ports(one_service("mongo", ["27017:27017"]), "local")

    assert [finding.severity for finding in findings] == ["fail"]
    assert "binds every interface" in findings[0].detail
    assert "mongo" in findings[0].detail


def test_a_service_publishing_nothing_is_not_examined():
    """Most services declare no `ports` at all, and absence is not a bind."""
    assert mirror.off_host_ports({"services": {"backend": {"image": "x"}}}, "prod") == []


def test_host_networking_fails_although_it_declares_no_port():
    """The widest exposure there is, and the one that answers nothing to a reader of `ports`."""
    findings = mirror.off_host_ports({"services": {"backend": {"network_mode": "host"}}}, "prod")

    assert [finding.severity for finding in findings] == ["fail"]
    assert "host's own network" in findings[0].detail


def test_a_ports_value_this_reader_cannot_judge_fails_rather_than_passing():
    """A shape the reader cannot parse is not a shape it may call safe."""
    findings = mirror.off_host_ports({"services": {"mongo": {"ports": "27017:27017"}}}, "local")

    assert [finding.severity for finding in findings] == ["fail"]
    assert "cannot judge" in findings[0].detail


def test_the_module_under_test_is_this_repository_own():
    """Names the import-order hazard the withdrawal above prevents, rather than leaving it silent.

    A `checker_kernel` resolved from `test_check_docs.py`'s throwaway copy would root this module at
    that copy, and every check below would then pass against a fixture instead of the repository.
    """
    assert mirror.REPO_ROOT == SCRIPTS.parent


def test_the_repository_own_compose_files_are_clean():
    """The check is driven against the real files, so a plant in either is a failure here too."""
    prod = mirror.load(mirror.REPO_ROOT / mirror.PROD)
    local = mirror.load(mirror.REPO_ROOT / mirror.LOCAL)

    assert mirror.off_host_ports(prod, mirror.PROD) == []
    assert mirror.off_host_ports(local, mirror.LOCAL) == []
