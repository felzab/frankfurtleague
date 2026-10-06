from collections.abc import Awaitable, Callable, Iterator, Mapping
from typing import Any

from pymongo import AsyncMongoClient, monitoring
from pymongo.asynchronous.database import AsyncDatabase

# Which reads a case asks the plan of, by the collection a find or aggregate names and its command.
Wanted = Callable[[str, Mapping[str, Any]], bool]

# What the driver wraps around a read rather than what plans it: the server refuses a second `$db`
# beside the explain's own, and the session, transaction and read concern belong to a finished read.
ENVELOPE = frozenset({"$db", "$clusterTime", "$readPreference", "lsid", "txnNumber", "autocommit", "startTransaction", "readConcern"})


class SentReads(monitoring.CommandListener):
    """Every find and aggregate this client sends that `wanted` picks, with its collection, stripped to what plans it."""

    def __init__(self, wanted: Wanted) -> None:
        self._wanted = wanted
        self.sent: list[tuple[str, dict[str, Any]]] = []

    def started(self, event: monitoring.CommandStartedEvent) -> None:
        if event.command_name not in ("find", "aggregate"):
            return
        command = event.command
        collection = str(command[event.command_name])
        if self._wanted(collection, command):
            self.sent.append((collection, {key: value for key, value in command.items() if key not in ENVELOPE}))

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        """Required by the listener interface; a read is judged as it is sent."""

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        """Required by the listener interface; a failed read was still sent with its filter."""


def _winning_scans(node: Any) -> Iterator[str]:
    """Each scan in an explain's winning plans, spelled as a profiler's `planSummary` spells one: `IXSCAN { email: 1 }`."""

    if isinstance(node, Mapping):
        if str(node.get("stage", "")).endswith("SCAN"):
            pattern = ", ".join(f"{field}: {direction}" for field, direction in (node.get("keyPattern") or {}).items())
            yield f"{node['stage']} {{ {pattern} }}" if pattern else str(node["stage"])
        for key, value in node.items():
            if key != "rejectedPlans":
                yield from _winning_scans(value)
    elif isinstance(node, list):
        for item in node:
            yield from _winning_scans(item)


async def plans_of_sent_reads[T](
    url: str,
    database: AsyncDatabase,
    read: Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[T]],
    wanted: Wanted,
) -> tuple[T, list[tuple[str, str]]]:
    """`read`'s answer over `database`, and each read it sent that `wanted` picks: its collection, and the server's plan for it."""

    reads = SentReads(wanted)
    # A client of the read's own, so the listener sees its commands and none of the seeding.
    watched = AsyncMongoClient(url, event_listeners=[reads])
    try:
        answer = await read(watched[database.name], watched)
    finally:
        await watched.close()

    # Explained rather than profiled: the server drops a profile entry it cannot write within
    # `internalQueryGlobalProfilingLockDeadlineMs`, which the xdist workers sharing it make routine.
    explained = [(collection, await database.command({"explain": command, "verbosity": "queryPlanner"})) for collection, command in reads.sent]

    return answer, [(collection, ", ".join(_winning_scans(plan))) for collection, plan in explained]
