import os

# `xdist/remote.py` sets this in every worker process; it is absent on a serial run and on the xdist
# controller, where a bare name is already this process's alone.
WORKER = os.environ.get("PYTEST_XDIST_WORKER", "")

_UNSCOPED = (
    "'{database}' is not this worker's own. Every database the db tier names goes through"
    " `tests/worker.py :: worker_database`; two workers holding one name would each empty the other's seeds mid-test,"
    " and the test that failed for it would be somewhere else entirely."
)


def worker_database(name: str) -> str:
    """`name` under this worker alone.

    Workers share one `mongod` and are separate processes, so a name is only isolating while it
    carries the worker that chose it.
    """

    return f"{name}_{WORKER}" if WORKER else name


def assert_worker_database(name: str) -> None:
    """Refuses a database name that never passed through `worker_database`, at the seed rather than in a neighbour's assertion."""

    if WORKER and not name.endswith(f"_{WORKER}"):
        raise AssertionError(_UNSCOPED.format(database=name))
