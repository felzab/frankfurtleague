"""SCRIPTS · the compose mirror, both halves

`check_compose_mirror.py :: DECLARED_DELTAS` covers a whole service at once, so the comparison never
reads the ports of a service only one file declares. This drives the check that does, which is what
holds `docs/ops/spec.md :: I1` for a service the mirror waves through.

It drives the comparison too: `diff` finding the disagreements, `declaring` deciding which are
allowed, and `uncovered` failing a declared delta that covers nothing. Those run against documents
the test writes, so they pin the mechanism rather than either compose file's current wording.

Stdlib only, and `scripts/checks/` is put on the path here because the module under test is run
as a script everywhere else, which is what seeds that directory onto the path for it.
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
sys.path.insert(0, str(SCRIPTS / "checks"))
try:
    mirror = importlib.import_module("check_compose_mirror")
finally:
    sys.path.remove(str(SCRIPTS / "checks"))
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

    A `checker_kernel` from `test_check_docs.py`'s throwaway copy would root this module there.
    """
    assert mirror.REPO_ROOT == SCRIPTS.parent


def test_the_repository_own_compose_files_are_clean():
    """The check is driven against the real files, so a plant in either is a failure here too."""
    prod = mirror.load(mirror.REPO_ROOT / mirror.PROD)
    local = mirror.load(mirror.REPO_ROOT / mirror.LOCAL)

    assert mirror.off_host_ports(prod, mirror.PROD) == []
    assert mirror.off_host_ports(local, mirror.LOCAL) == []


def test_documents_that_agree_produce_no_difference():
    """The mirror's resting state: nothing to judge means nothing to declare."""
    document = {"services": {"nginx": {"image": "nginx:1.31-alpine", "restart": "unless-stopped"}}}

    assert mirror.diff(document, document) == []


def test_a_key_only_the_production_file_writes_reads_as_absent_locally():
    """`ABSENT` is a value rather than a gap, which is what lets a delta pin one side of it."""
    found = mirror.diff({"services": {"a": {"deploy": {"x": 1}}}}, {"services": {"a": {}}})

    assert [(one.path, one.local) for one in found] == [("services.a.deploy", mirror.ABSENT)]


def test_a_key_only_the_local_file_writes_reads_as_absent_in_production():
    """The same reported the other way, which is the side every `build` delta pins."""
    found = mirror.diff({"services": {"a": {}}}, {"services": {"a": {"build": {"context": "."}}}})

    assert [(one.path, one.prod) for one in found] == [("services.a.build", mirror.ABSENT)]


def test_a_difference_is_reported_at_the_deepest_key_the_two_share():
    """Reporting a whole service for one changed scalar would need a delta far wider than the change."""
    found = mirror.diff(
        {"services": {"a": {"healthcheck": {"retries": 3, "interval": "30s"}}}},
        {"services": {"a": {"healthcheck": {"retries": 5, "interval": "30s"}}}},
    )

    assert [(one.path, one.prod, one.local) for one in found] == [("services.a.healthcheck.retries", 3, 5)]


def test_a_list_differs_whole_rather_than_entry_by_entry():
    """`services.nginx.ports` is pinned as a list, so the comparison has to disagree as a list too."""
    found = mirror.diff({"p": ["80:80", "443:443"]}, {"p": ["3000:80"]})

    assert [(one.path, one.prod, one.local) for one in found] == [("p", ["80:80", "443:443"], ["3000:80"])]


def test_several_disagreements_are_all_reported():
    """A run stopping at the first would leave the rest to surface one gate run at a time."""
    found = mirror.diff({"a": 1, "b": 2}, {"a": 9, "b": 8})

    assert sorted(one.path for one in found) == ["a", "b"]


def test_any_accepts_whatever_that_file_writes():
    """Most rows pin one side and leave the other free, because only one side is the claim."""
    assert mirror.side_matches(mirror.ANY, ["3000:80"]) is True
    assert mirror.side_matches(mirror.ANY, "") is True


def test_any_does_not_accept_a_missing_key():
    """`ANY` says "whatever that file writes there", and a file that writes nothing wrote nothing."""
    assert mirror.side_matches(mirror.ANY, mirror.ABSENT) is False


def test_a_pinned_side_is_matched_by_equality_alone():
    """A pinned row is the one that fails when a port or a mount is added beside the declared one."""
    assert mirror.side_matches(["80:80"], ["80:80"]) is True
    assert mirror.side_matches(["80:80"], ["80:80", "8080:8080"]) is False


PINNED = mirror.Delta("services.nginx.ports", ["80:80"], ["3000:80"], "the edge is published differently")
FREE = mirror.Delta("services.a.build", mirror.ABSENT, mirror.ANY, "the local stack builds from source")


def test_a_difference_both_sides_of_a_row_describe_is_declared(monkeypatch):
    """The ordinary case, and the one every row on the real list is meant to be in."""
    monkeypatch.setattr(mirror, "DECLARED_DELTAS", (PINNED, FREE))
    difference = mirror.Difference("services.nginx.ports", ["80:80"], ["3000:80"])

    assert mirror.declaring(difference) is PINNED


def test_a_row_whose_path_matches_but_whose_pinned_value_no_longer_does_declares_nothing(monkeypatch):
    """A port added beside the declared one has to fail, or the pin buys nothing over `ANY`."""
    monkeypatch.setattr(mirror, "DECLARED_DELTAS", (PINNED,))
    difference = mirror.Difference("services.nginx.ports", ["80:80", "8080:8080"], ["3000:80"])

    assert mirror.declaring(difference) is None


def test_a_difference_at_a_path_no_row_names_declares_nothing(monkeypatch):
    """The undeclared-difference finding, which is the checker's primary claim."""
    monkeypatch.setattr(mirror, "DECLARED_DELTAS", (PINNED, FREE))

    assert mirror.declaring(mirror.Difference("services.a.restart", "always", "no")) is None


def test_a_row_matching_a_difference_is_returned(monkeypatch):
    """Named rather than merely counted, because `--verbose` prints the reason it carries."""
    monkeypatch.setattr(mirror, "DECLARED_DELTAS", (PINNED, FREE))
    difference = mirror.Difference("services.a.build", mirror.ABSENT, {"context": "."})

    assert mirror.declaring(difference) is FREE


def test_a_row_that_covered_a_difference_is_not_reported_as_rot(monkeypatch):
    """Every row earning its place is the state a clean gate run reports."""
    monkeypatch.setattr(mirror, "DECLARED_DELTAS", (PINNED, FREE))
    judged = [
        (mirror.Difference("services.nginx.ports", ["80:80"], ["3000:80"]), PINNED),
        (mirror.Difference("services.a.build", mirror.ABSENT, {"context": "."}), FREE),
    ]

    assert mirror.uncovered(judged) == []


def test_a_row_covering_nothing_is_a_finding(monkeypatch):
    """Allowlist rot pointed the way nothing usually catches: the files agreed and the claim stayed."""
    monkeypatch.setattr(mirror, "DECLARED_DELTAS", (PINNED, FREE))
    judged = [(mirror.Difference("services.a.build", mirror.ABSENT, {"context": "."}), FREE)]

    findings = mirror.uncovered(judged)

    assert [finding.severity for finding in findings] == ["fail"]
    assert "services.nginx.ports" in findings[0].detail
    assert PINNED.why in findings[0].detail


def test_every_row_covering_nothing_is_reported(monkeypatch):
    """A run naming one row at a time would take a gate run per stale claim to clear the list."""
    monkeypatch.setattr(mirror, "DECLARED_DELTAS", (PINNED, FREE))

    assert len(mirror.uncovered([])) == 2


def test_two_rows_sharing_a_path_do_not_mark_each_other_covered(monkeypatch):
    """Why `uncovered` compares identity: equality would let one row answer for the other."""
    twin = mirror.Delta(PINNED.path, PINNED.prod, PINNED.local, PINNED.why)
    monkeypatch.setattr(mirror, "DECLARED_DELTAS", (PINNED, twin))
    judged = [(mirror.Difference(PINNED.path, PINNED.prod, PINNED.local), PINNED)]

    assert len(mirror.uncovered(judged)) == 1


def test_the_repository_own_compose_pair_is_fully_declared():
    """The real list against the real files, so a mis-expressed row fails here and not only at the gate.

    Both directions at once: no difference the list misses, and no row the files do not justify.
    """
    prod = mirror.load(mirror.REPO_ROOT / mirror.PROD)
    local = mirror.load(mirror.REPO_ROOT / mirror.LOCAL)
    judged = [(difference, mirror.declaring(difference)) for difference in mirror.diff(prod, local)]

    assert [difference.path for difference, delta in judged if delta is None] == []
    assert mirror.uncovered(judged) == []
    assert len(judged) == len(mirror.DECLARED_DELTAS)
