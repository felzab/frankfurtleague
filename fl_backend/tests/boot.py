"""
TESTS · the image's own boot, run in a process of its own over an environment and a secrets folder the case writes

The process inherits nothing from the run that starts it: a developer's environment and the checkout's secrets folder can
name a real deployment, and a boot reading either would open it. Its output is read back as the container log holds it,
both streams in one, and a case asserts on names and event keys alone: `--showlocals` prints every local of a failing
case, so a secret value, a made-up one included, never sits in one.
"""

import asyncio
import contextlib
import json
import os
import re
import sys
from collections.abc import AsyncGenerator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from app.core.concurrency import concurrently
from app.core.db import SERVER_SELECTION_TIMEOUT_MS

BACKEND_ROOT: Final = Path(__file__).resolve().parents[1]
DOCKERFILE: Final = BACKEND_ROOT / "Dockerfile"

# Far past the longest boot run to its exit, one waiting out the driver's server selection, so only a boot that hangs
# reaches it. `booted` runs in a module fixture, outside any case's bound.
BOOT_BOUND_S: Final = SERVER_SELECTION_TIMEOUT_MS / 1000 + 45

# The shape of the application's own log message (`app/core/logging.py`), which carries no value; uvicorn's lines and a
# traceback's do not take it.
EVENT = re.compile(r"[a-z_]+\.[a-z_]+")


class Withheld(dict[str, str]):
    """A mapping holding secret values, which prints its keys alone."""

    def __repr__(self) -> str:
        return f"Withheld({sorted(self)})"


def image_command() -> list[str]:
    """The exec-form `CMD` the image runs, as its arguments."""

    command = [line for line in DOCKERFILE.read_text(encoding="utf-8").splitlines() if line.startswith("CMD [")]
    assert len(command) == 1, f"{DOCKERFILE} holds {len(command)} exec-form CMD lines, where this reads exactly one"

    return json.loads(command[0].removeprefix("CMD "))


def boot_command() -> list[str]:
    """The image's command from its server on, run by this interpreter on a loopback port the system picks.

    `tini` routes signals as a container's first process, which a process started here is not. The working directory is
    the case's own, so the package is found from its folder.
    """

    command = image_command()
    arguments = command[command.index("uvicorn") + 1 :]
    arguments[arguments.index("--host") + 1] = "127.0.0.1"
    arguments[arguments.index("--port") + 1] = "0"

    return [sys.executable, "-m", "uvicorn", *arguments, "--app-dir", str(BACKEND_ROOT)]


def environment(secrets: Path, variables: Mapping[str, str]) -> Withheld:
    """`variables` and the secrets folder, with the image's own `ENV` and nothing of this machine's but one name.

    Every process a case starts from the backend runs over one: a developer's environment can name a real deployment.
    """

    environment = Withheld({"PYTHONUNBUFFERED": "1", "SECRETS_DIR": str(secrets), **variables})
    # Windows' sockets cannot load their providers without it, so `asyncio` fails at its import (WinError 10106); it
    # alone passes through.
    if "SYSTEMROOT" in os.environ:
        environment["SYSTEMROOT"] = os.environ["SYSTEMROOT"]

    return environment


# The folder in a boot's directory its secrets are written to.
SECRETS_FOLDER: Final = "run-secrets"


def secrets_folder(directory: Path, files: Mapping[str, str]) -> Path:
    secrets = directory / SECRETS_FOLDER
    # A case may have made it already, to leave there what no value writes: a directory at a file's path.
    secrets.mkdir(exist_ok=True)
    for name, value in files.items():
        # Bytes: a text-mode write would end each file in a carriage return on Windows. A lone surrogate writes the byte
        # it escapes, so a value can end in one UTF-8 cannot decode.
        (secrets / name).write_bytes(value.encode(errors="surrogateescape"))

    return secrets


@dataclass(frozen=True)
class Boot:
    """What a boot left: its exit code and its log, which prints as its exit code and event keys alone."""

    code: int | None
    output: str

    def __repr__(self) -> str:
        return f"Boot(code={self.code}, events={self.events})"

    @property
    def records(self) -> list[dict[str, Any]]:
        """Each line the application's JSON formatter wrote; a traceback's lines are no record."""

        records: list[dict[str, Any]] = []
        for line in self.output.splitlines():
            try:
                record = json.loads(line)
            except ValueError:
                continue
            if isinstance(record, dict):
                records.append(record)

        return records

    @property
    def events(self) -> list[str]:
        return [record["message"] for record in self.records if EVENT.fullmatch(str(record.get("message")))]

    def record(self, event: str) -> dict[str, Any]:
        (found,) = [record for record in self.records if record.get("message") == event]
        return found

    def leaked(self, values: Mapping[str, str]) -> list[str]:
        """The name of each value the log carries anywhere, never the value."""

        return sorted(name for name, value in values.items() if value in self.output)


@asynccontextmanager
async def _boot(directory: Path, files: Mapping[str, str], variables: Mapping[str, str]) -> AsyncGenerator[asyncio.subprocess.Process]:
    """The boot started from `directory`, with `files` as its secrets and `variables` as its whole environment, held running.

    Both streams in one, as the container log holds them. Killed and reaped as the block leaves, by any path a sibling's
    failure included: no case reads anything a boot does after its block.
    """

    process = await asyncio.create_subprocess_exec(
        *boot_command(),
        cwd=directory,
        env=environment(secrets_folder(directory, files), variables),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        yield process
    finally:
        # A process that has just exited is no error.
        with contextlib.suppress(ProcessLookupError):
            process.kill()
        await process.wait()


async def _to_its_exit(directory: Path, files: Mapping[str, str], variables: Mapping[str, str]) -> Boot:
    async with _boot(directory, files, variables) as process:
        async with asyncio.timeout(BOOT_BOUND_S):
            output, _ = await process.communicate()

    return Boot(process.returncode, output.decode("utf-8", errors="replace"))


Booting = tuple[Path, Mapping[str, str], Mapping[str, str]]


async def booted(boots: Mapping[str, Booting]) -> dict[str, Boot]:
    """Each boot, from its directory with its secrets and its variables, run to its exit, all at once.

    At once, since most of a boot is a wait: an import, or the driver's server selection.
    """

    names = list(boots)
    ended = await concurrently(*(_to_its_exit(*boots[name]) for name in names))

    return dict(zip(names, ended, strict=True))


@asynccontextmanager
async def serving(directory: Path, files: Mapping[str, str], variables: Mapping[str, str], *, until: str) -> AsyncGenerator[Boot]:
    """The boot, held running from the line `until` names until the block leaves; what it logged by then, or by its exit."""

    async with _boot(directory, files, variables) as process:
        assert process.stdout is not None
        lines: list[bytes] = []
        # Under the case's bound, inside which every caller holds it.
        while line := await process.stdout.readline():
            lines.append(line)
            if Boot(None, line.decode("utf-8", errors="replace")).events == [until]:
                break
        yield Boot(process.returncode, b"".join(lines).decode("utf-8", errors="replace"))


def names(sentence: str | None, opening: str) -> set[str]:
    """The names a refusal lists after `opening`, each a name a file or a variable can carry and so never a value."""

    found = re.search(rf"{re.escape(opening)}: ([A-Za-z_]+(?:, [A-Za-z_]+)*)(?:;|$)", sentence or "")

    return set(found[1].split(", ")) if found else set()
