from collections.abc import Generator
from contextlib import contextmanager

from pymongo import MongoClient
from pymongo.database import Database

from app.core.config import BackendConfig
from tests.config import build_test_config

# A dict rather than a model: Pydantic could not express a row its record model rejects.
AUSTRITT = {"type": "disqualifikation", "reason": "Nicht angetreten zum Spieltag", "date": "2026-03-14"}


def config_for(database_name: str) -> BackendConfig:
    """`build_test_config`'s settings against a database of the caller's own.

    What it is for: a body that WRITES, in a module whose other cases share one seeded corpus. Given
    the shared database it would leave them a corpus nobody seeded.
    """

    return build_test_config().model_copy(update={"db_base_name": database_name})


# One module's shared corpus: every collection it holds, each as its documents in an order two
# reads of an untouched database agree on.
Corpus = dict[str, list[str]]

_WROTE = (
    "'{database}' holds documents its seed did not put there ({moved}). A module sharing one corpus across its tests admits reads"
    " alone: a body that writes hands the next test a corpus nobody seeded, and fails it somewhere else entirely."
)


def _documents(database: Database) -> Corpus:
    """Views and `system.*` are listed beside real collections and hold nothing a seed put there."""

    return {
        info["name"]: sorted(repr(document) for document in database[info["name"]].find())
        for info in database.list_collections()
        if info.get("type") == "collection" and not str(info["name"]).startswith("system.")
    }


@contextmanager
def unwritten(url: str, database_name: str) -> Generator[None]:
    """Fails a module that WROTE to the corpus seeded once for it, naming the collections it moved.

    `tests/database.py :: _schema` compares the schema instead, which a write never touches.
    """

    # A client of its own: the seeding one is asynchronous, and this guard's comparison is synchronous.
    client = MongoClient(url)
    try:
        seeded = _documents(client[database_name])

        yield

        present = _documents(client[database_name])
        moved = sorted(name for name in seeded.keys() | present.keys() if seeded.get(name) != present.get(name))

        assert not moved, _WROTE.format(database=database_name, moved=", ".join(moved))
    finally:
        client.close()
