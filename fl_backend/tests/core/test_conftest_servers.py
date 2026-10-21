from collections.abc import Callable
from contextlib import AbstractContextManager
from functools import partial
from typing import Any

import pytest

import tests.conftest as harness

# Logged by a shell standing in for mongod, which exits as a refusing mongod does: mongod's own refusal
# depends on the host, since it refuses some kernels before it reads its command line.
EXIT_MARKER = "logged before exiting at start"

# Logged by a shell standing in for mongod, which keeps running and answers nothing, so the set it
# should host never initiates.
SILENT_MARKER = "logged by a server that never answers"

# The driver's own wait for a server, cut from its 30 s: none is coming.
SELECTION_TIMEOUT_MS = 1000

SERVERS = pytest.mark.parametrize("server", [harness._standalone_mongod, harness._replica_set_mongod], ids=["standalone", "replica_set"])

Server = Callable[[], AbstractContextManager[str]]


def _stood_in(monkeypatch: pytest.MonkeyPatch, script: str) -> list[Any]:
    """Every container of `MONGO_IMAGE` the test creates, each a shell running `script`."""

    from testcontainers.core.docker_client import DockerClient

    create = DockerClient.create
    created: list[Any] = []

    def standing_in(client: DockerClient, image: str, command: str | None = None, **kwargs: Any) -> Any:
        # The reaper's image passes untouched: a refused reaper fails the start before mongod runs.
        if image != harness.MONGO_IMAGE:
            return create(client, image, command, **kwargs)
        kwargs["entrypoint"] = "sh"
        container = create(client, image, ["-c", script], **kwargs)
        created.append(container)
        return container

    monkeypatch.setattr(DockerClient, "create", standing_in)
    return created


@pytest.mark.db
@SERVERS
def test_a_server_exiting_at_start_fails_naming_its_log_and_leaves_no_container(server: Server, monkeypatch: pytest.MonkeyPatch) -> None:
    from docker.errors import NotFound

    refused_at_start = _stood_in(monkeypatch, f"echo '{EXIT_MARKER}'; exit 1")

    with pytest.raises(RuntimeError) as excinfo, server():
        pass

    assert EXIT_MARKER in str(excinfo.value), f"the container's log never reached the error: {excinfo.value}"
    # Not implied by the marker, which comes from the container's log whatever `_stood_in` recorded.
    assert refused_at_start, "no container of the image was recorded, so the removal below checks nothing"
    for container in refused_at_start:
        with pytest.raises(NotFound):
            container.reload()


@pytest.mark.db
def test_a_replica_set_that_never_initiates_fails_naming_its_log_and_leaves_no_container(monkeypatch: pytest.MonkeyPatch) -> None:
    from docker.errors import NotFound
    from pymongo import MongoClient
    from pymongo.errors import ServerSelectionTimeoutError

    # The line the start waits for, then nothing listening: the start passes, and `replSetInitiate` reaches no server.
    stood_in = _stood_in(monkeypatch, f"echo '{SILENT_MARKER}'; echo 'waiting for connections'; exec sleep 600")
    monkeypatch.setattr(harness, "MongoClient", partial(MongoClient, serverSelectionTimeoutMS=SELECTION_TIMEOUT_MS))

    with pytest.raises(RuntimeError) as excinfo, harness._replica_set_mongod():
        pass

    assert isinstance(excinfo.value.__cause__, ServerSelectionTimeoutError), f"the set failed before it was asked to initiate: {excinfo.value}"
    assert SILENT_MARKER in str(excinfo.value), f"the container's log never reached the error: {excinfo.value}"
    # Not implied by the marker, which comes from the container's log whatever `_stood_in` recorded.
    assert stood_in, "no container of the image was recorded, so the removal below checks nothing"
    for container in stood_in:
        with pytest.raises(NotFound):
            container.reload()


@pytest.mark.db
@SERVERS
def test_a_container_the_daemon_never_created_fails_with_the_daemon_s_own_error(server: Server, monkeypatch: pytest.MonkeyPatch) -> None:
    """A container never created has no log, and reading one raises an error of its own in the daemon's place."""

    from docker.errors import APIError
    from testcontainers.core.docker_client import DockerClient

    create = DockerClient.create

    def refused(client: DockerClient, image: str, *args: Any, **kwargs: Any) -> Any:
        if image == harness.MONGO_IMAGE:
            raise APIError("the daemon refused the create")
        return create(client, image, *args, **kwargs)

    monkeypatch.setattr(DockerClient, "create", refused)

    with pytest.raises(APIError, match="the daemon refused the create"), server():
        pass
