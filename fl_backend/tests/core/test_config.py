"""
CORE · the settings a boot reads, and what its refusals print

Each case runs the image's own command in a process of its own (`tests/boot.py`), so what it judges is the log the
container would hold and the code it would exit with. Every secret here is made up, and each holds a digit and a hyphen,
which no name a refusal lists can carry.
"""

import asyncio
from pathlib import Path

import pytest
from pymongo import MongoClient

from app.core.config import INTERNAL_API_KEY_LENGTH, MONGODB_URI_FILE, SECRET_FILES
from app.core.constraints import SUPPORT_INDEXES, TTL_INDEXES, UNIQUE_INDEXES
from app.core.db import NO_SERVER, UNREACHABLE
from app.main import BOOT_REFUSED
from tests.boot import Boot, Withheld, booted, names, serving
from tests.worker import worker_database

# What uvicorn exits with when the application's start fails, the code a refusal at the import takes too.
STARTUP_FAILED = 3


def a_key(prefix: str, length: int = INTERNAL_API_KEY_LENGTH) -> str:
    return prefix.ljust(length, "0")


KEYS = Withheld(
    {
        "internal_api_key_base": a_key("Made-Up-Base-7"),
        "internal_api_key_system": a_key("Made-Up-System-7"),
        "internal_api_key_admin": a_key("Made-Up-Admin-7"),
    }
)

# A value the scheme check passes and the driver refuses as it builds its client, so a boot past the settings ends at
# once, before any network is asked.
NO_SERVER_URI = "mongodb://"

# What a boot's environment carries beside its secrets: a container's, as Compose hands it the dotenv file's names.
VARIABLES = {"DB_BASE_NAME": "fl_boot_test"}

# The variable each file's credential is read from where the environment carries it: the name the settings look the
# file's name up by.
VARIABLE_OF = {file: file.upper() for file in SECRET_FILES}


# Every file refused at once, each by its own rule.
REFUSED = Withheld(
    {
        MONGODB_URI_FILE: "reader:Made-Up-Password-7@localhost:27017",
        **{file: a_key(f"Too-Short-{file}-7", INTERNAL_API_KEY_LENGTH - 1) for file in KEYS},
    }
)

# A key's variable left behind beside its file, holding a value the settings refuse.
STALE = Withheld({VARIABLE_OF["internal_api_key_base"]: a_key("Stale-Variable-7", INTERNAL_API_KEY_LENGTH - 1)})

# A value the settings accept in every file's variable, standing in for files never written.
STANDING_IN = Withheld(
    {
        VARIABLE_OF[MONGODB_URI_FILE]: "mongodb://Made-Up-Host-7:27017",
        **{VARIABLE_OF[file]: a_key(f"Stand-In-{file}-7") for file in KEYS},
    }
)

# TEST-NET-1 (RFC 5737), which no host answers, on a port no `mongod` this repository starts listens on: the ping fails
# for the one reason its case is about wherever it runs, after the driver's own server selection.
UNREACHABLE_HOST = "192.0.2.1"
UNREACHABLE_URI = Withheld({MONGODB_URI_FILE: f"mongodb://{UNREACHABLE_HOST}:27018"})

# Each case's secret files and whole environment.
BOOTS = {
    "refused": (REFUSED, VARIABLES),
    "stale": (Withheld({MONGODB_URI_FILE: NO_SERVER_URI, **KEYS}), Withheld({**VARIABLES, **STALE})),
    "missing": ({}, Withheld({**VARIABLES, **STANDING_IN})),
    "misspelled": (Withheld({MONGODB_URI_FILE: NO_SERVER_URI, **KEYS}), {"DB_BASE_NAMES": VARIABLES["DB_BASE_NAME"]}),
    "unreachable": (Withheld({**UNREACHABLE_URI, **KEYS}), VARIABLES),
}


@pytest.fixture(scope="module")
def boots(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Boot]:
    """Every case's boot at once, each from a folder of its own, so the others end inside the unreachable server's wait."""

    return booted({name: (tmp_path_factory.mktemp(name), files, variables) for name, (files, variables) in BOOTS.items()})


class TestARefusal:
    def test_never_repeats_a_secret_s_value(self, boots: dict[str, Boot]):
        """Every file refused at once, each by its own rule, and the container log is the whole exposure: a name is all an operator needs."""

        boot = boots["refused"]

        assert (boot.code, boot.events) == (BOOT_REFUSED, ["system.config_refused"])
        assert names(boot.record("system.config_refused")["refusal"], "Invalid secret files") == set(SECRET_FILES)
        assert boot.leaked(REFUSED) == []


class TestASecretFile:
    def test_beats_a_stale_variable_of_its_own_name(self, boots: dict[str, Boot]):
        """pydantic-settings ranks a variable above a secret file, so one left behind would win in silence.

        The variable holds a value the settings refuse, so which of the two won shows in whether the boot gets past them:
        the file's key is taken, and the boot stops at the database the file names.
        """

        boot = boots["stale"]

        assert (boot.code, boot.events) == (STARTUP_FAILED, [NO_SERVER.event])

    def test_missing_is_named_without_the_value_a_variable_holds_for_it(self, boots: dict[str, Boot]):
        """Over every file the class reads, none written: a variable standing in for a missing file would boot on a value nobody chose.

        Each variable carries a value the settings accept, so only the missing file refuses the boot.
        """

        boot = boots["missing"]

        assert (boot.code, boot.events) == (BOOT_REFUSED, ["system.config_refused"])
        assert names(boot.record("system.config_refused")["refusal"], "Invalid secret files") == set(SECRET_FILES)
        assert boot.leaked(STANDING_IN) == []


class TestAMisspelledVariable:
    def test_fails_the_boot(self, boots: dict[str, Boot]):
        """Compose hands the container its dotenv file's names as variables, and the settings read declared names alone.

        So a misspelling refuses the boot only where the name it misses has no default; one with a default boots on it.
        """

        boot = boots["misspelled"]

        assert (boot.code, boot.events) == (BOOT_REFUSED, ["system.config_refused"])
        assert names(boot.record("system.config_refused")["refusal"], "Invalid environment variables") == {"DB_BASE_NAME"}


class TestAServerThatCannotBeReached:
    def test_is_named_by_its_file_and_never_by_its_host(self, boots: dict[str, Boot]):
        """The driver's message carries the host it resolved out of the value, which is the half an operator must not be handed."""

        boot = boots["unreachable"]

        assert (boot.code, boot.events) == (STARTUP_FAILED, [UNREACHABLE.event])
        assert boot.record(UNREACHABLE.event)["file"] == MONGODB_URI_FILE
        assert boot.leaked(Withheld({"host": UNREACHABLE_HOST, **UNREACHABLE_URI})) == []


@pytest.mark.db
class TestTheBoot:
    def test_builds_the_indexes_in_the_database_the_settings_name(self, tmp_path: Path, mongo_replica_set_url: str):
        """A unique index is the one guard against two writes racing for a key, and one built elsewhere guards nothing."""

        database = worker_database("fl_boot_indexes")
        declared = {(index.collection, index.name) for index in (*UNIQUE_INDEXES, *SUPPORT_INDEXES, *TTL_INDEXES)}

        async def built() -> Boot:
            async with serving(
                tmp_path, Withheld({MONGODB_URI_FILE: mongo_replica_set_url, **KEYS}), {"DB_BASE_NAME": database}, until="system.started"
            ) as boot:
                return boot

        client: MongoClient = MongoClient(mongo_replica_set_url)
        try:
            client.drop_database(database)

            boot = asyncio.run(built())

            held = client[database]
            indexes = {(name, spec["name"]) for name in held.list_collection_names() for spec in held[name].list_indexes()}
        finally:
            client.drop_database(database)
            client.close()

        assert "system.started" in boot.events
        assert declared - indexes == set()
