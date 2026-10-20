from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import Any

import pytest

import tests.conftest as harness

# Logged by a shell standing in for mongod, which exits as a refusing mongod does: mongod's own refusal
# depends on the host, since it refuses some kernels before it reads its command line.
EXIT_MARKER = "logged before exiting at start"

SERVERS = pytest.mark.parametrize("server", [harness._standalone_mongod, harness._replica_set_mongod], ids=["standalone", "replica_set"])

Server = Callable[[], AbstractContextManager[str]]


@pytest.fixture
def refused_at_start(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    """Every container of `MONGO_IMAGE` the test creates, each a shell logging `EXIT_MARKER` and exiting 1."""

    from testcontainers.core.docker_client import DockerClient

    create = DockerClient.create
    created: list[Any] = []

    def refusing(client: DockerClient, image: str, command: str | None = None, **kwargs: Any) -> Any:
        # The reaper's image passes untouched: a refused reaper fails the start before mongod runs.
        if image != harness.MONGO_IMAGE:
            return create(client, image, command, **kwargs)
        container = create(client, image, ["-c", f"echo '{EXIT_MARKER}'; exit 1"], **{**kwargs, "entrypoint": "sh"})
        created.append(container)
        return container

    monkeypatch.setattr(DockerClient, "create", refusing)
    return created


@pytest.mark.db
@SERVERS
def test_a_server_exiting_at_start_fails_naming_its_log_and_leaves_no_container(server: Server, refused_at_start: list[Any]) -> None:
    from docker.errors import NotFound

    with pytest.raises(RuntimeError) as excinfo, server():
        pass

    assert EXIT_MARKER in str(excinfo.value), f"the container's log never reached the error: {excinfo.value}"
    assert refused_at_start, "no container of the image was created, so nothing was refused"
    for container in refused_at_start:
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
