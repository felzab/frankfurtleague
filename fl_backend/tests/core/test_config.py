"""
CORE · the settings a boot reads, and what its refusals print

Each case runs the image's own command in a process of its own (`tests/boot.py`), so what it judges is the log the
container would hold and the code it would exit with. Every secret here is made up, and each holds a digit and a hyphen,
which no name a refusal lists can carry.
"""

import os
from pathlib import Path

import pytest
from pymongo import AsyncMongoClient

from app.core.collections import Collection
from app.core.config import INTERNAL_API_KEY_LENGTH, MONGODB_URI_FILE, SECRET_FILES
from app.core.constraints import SUPPORT_INDEXES, TTL_INDEXES, UNIQUE_INDEXES
from app.core.db import NO_SERVER, new_client
from app.main import BOOT_REFUSED
from tests.boot import SECRETS_FOLDER, Boot, Withheld, booted, names, serving
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

# Each pair of tiers holding one key, every key valid alone: a later key holding an earlier one's value.
SHARED = {
    "admin_holds_base": Withheld({**KEYS, "internal_api_key_admin": KEYS["internal_api_key_base"]}),
    "system_holds_base": Withheld({**KEYS, "internal_api_key_system": KEYS["internal_api_key_base"]}),
    "admin_holds_system": Withheld({**KEYS, "internal_api_key_admin": KEYS["internal_api_key_system"]}),
}

# Under `.invalid` (RFC 2606), which no resolver answers: the driver's lookup of the service record fails as the client
# is built, and its message quotes the host, without the wait for a server selection.
UNKNOWN_HOST = "made-up-host-7.invalid"
UNKNOWN_HOST_URI = Withheld({MONGODB_URI_FILE: f"mongodb+srv://{UNKNOWN_HOST}"})

# A pasted key's line keeping the dotenv shape, which makes its text the name the settings refuse as undeclared. Lower
# case, as the settings report the name, so a refusal naming it is a leak this finds.
PASTED = Withheld({"name": "made-up-pasted-key-7"})

# A key file holding a byte UTF-8 cannot decode at its end: a decode error's text quotes what it failed on.
UNDECODABLE = Withheld({"internal_api_key_base": a_key("Made-Up-Undecodable-7", INTERNAL_API_KEY_LENGTH - 1)})

# Each case's secret files and whole environment.
BOOTS = {
    "refused": (REFUSED, VARIABLES),
    "stale": (Withheld({MONGODB_URI_FILE: NO_SERVER_URI, **KEYS}), Withheld({**VARIABLES, **STALE})),
    "missing": ({}, Withheld({**VARIABLES, **STANDING_IN})),
    "misspelled": (Withheld({MONGODB_URI_FILE: NO_SERVER_URI, **KEYS}), {"DB_BASE_NAMES": VARIABLES["DB_BASE_NAME"]}),
    "unknown_host": (Withheld({**UNKNOWN_HOST_URI, **KEYS}), VARIABLES),
    **{pair: (Withheld({MONGODB_URI_FILE: NO_SERVER_URI, **keys}), VARIABLES) for pair, keys in SHARED.items()},
    "undeclared": (Withheld({MONGODB_URI_FILE: NO_SERVER_URI, **KEYS}), VARIABLES),
    "undecodable": (
        Withheld({MONGODB_URI_FILE: NO_SERVER_URI, **KEYS, "internal_api_key_base": f"{UNDECODABLE['internal_api_key_base']}\udcff"}),
        VARIABLES,
    ),
    # The base key's file is a directory, which the fixture leaves.
    "directory": (
        Withheld({MONGODB_URI_FILE: NO_SERVER_URI, **{file: key for file, key in KEYS.items() if file != "internal_api_key_base"}}),
        VARIABLES,
    ),
}


@pytest.fixture(scope="module")
async def boots(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Boot]:
    """Every case's boot at once, each from a folder of its own, so the file waits about as long as its slowest boot."""

    folders = {name: tmp_path_factory.mktemp(name) for name in BOOTS}
    # The package's dotenv file, which the settings read from the folder a boot starts in.
    (folders["undeclared"] / ".env").write_bytes(f"{PASTED['name']}=1\n".encode())
    (folders["directory"] / SECRETS_FOLDER / "internal_api_key_base").mkdir(parents=True)

    return await booted({name: (folders[name], files, variables) for name, (files, variables) in BOOTS.items()})


class TestARefusal:
    def test_never_repeats_a_secret_s_value(self, boots: dict[str, Boot]):
        """Every file refused at once, each by its own rule, and the container log is the whole exposure: a name is all an operator needs."""

        boot = boots["refused"]

        assert (boot.code, boot.events) == (BOOT_REFUSED, ["system.config_refused"])
        assert names(boot.record("system.config_refused")["refusal"], "Invalid secret files") == set(SECRET_FILES)
        assert boot.leaked(REFUSED) == []

    def test_counts_an_undeclared_name_and_never_names_it(self, boots: dict[str, Boot]):
        """The settings refuse an undeclared name by naming it, and a pasted key keeping the dotenv shape is that name."""

        boot = boots["undeclared"]

        assert (boot.code, boot.events) == (BOOT_REFUSED, ["system.config_refused"])
        assert boot.record("system.config_refused")["refusal"] == "Undeclared environment variables: 1"
        assert boot.leaked(PASTED) == []

    def test_names_an_undecodable_file_by_its_failure_alone(self, boots: dict[str, Boot]):
        """The settings' wrapper and the decode error under it each quote what they failed on, so neither text is logged."""

        boot = boots["undecodable"]

        assert (boot.code, boot.events) == (BOOT_REFUSED, ["system.config_refused"])
        assert boot.record("system.config_refused")["refusal"] == "The environment could not be read: UnicodeDecodeError"
        assert boot.leaked(Withheld({**KEYS, **UNDECODABLE})) == []

    def test_names_a_directory_at_a_file_s_path_by_its_path(self, boots: dict[str, Boot]):
        """What Docker leaves where a bind mount's source file was missing, which the settings only warn about."""

        boot = boots["directory"]

        assert (boot.code, boot.events) == (BOOT_REFUSED, ["system.config_refused"])
        refusal = boot.record("system.config_refused")["refusal"]
        assert refusal.startswith("Unreadable secret files: ") and refusal.endswith(f"{SECRETS_FOLDER}{os.sep}internal_api_key_base (EISDIR)")
        assert boot.leaked(KEYS) == []


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


class TestTwoKeysHoldingOneValue:
    @pytest.mark.parametrize(
        ("pair", "later"),
        [
            ("admin_holds_base", "internal_api_key_admin"),
            ("system_holds_base", "internal_api_key_system"),
            ("admin_holds_system", "internal_api_key_admin"),
        ],
    )
    def test_refuse_the_boot_naming_the_later_file(self, boots: dict[str, Boot], pair: str, later: str):
        """Two tiers holding one key are one tier, so a holder of the lower key would reach the other's routes."""

        boot = boots[pair]

        assert (boot.code, boot.events) == (BOOT_REFUSED, ["system.config_refused"])
        assert names(boot.record("system.config_refused")["refusal"], "Invalid secret files") == {later}
        assert boot.leaked(SHARED[pair]) == []


class TestAMisspelledVariable:
    def test_fails_the_boot(self, boots: dict[str, Boot]):
        """Compose hands the container its dotenv file's names as variables, and the settings read declared names alone.

        So a misspelling refuses the boot only where the name it misses has no default; one with a default boots on it.
        """

        boot = boots["misspelled"]

        assert (boot.code, boot.events) == (BOOT_REFUSED, ["system.config_refused"])
        assert names(boot.record("system.config_refused")["refusal"], "Invalid environment variables") == {"DB_BASE_NAME"}


class TestAServerThatCannotBeFound:
    def test_is_named_by_its_file_and_never_by_its_host(self, boots: dict[str, Boot]):
        """The driver's message carries the host it resolved out of the value, which is the half an operator must not be handed."""

        boot = boots["unknown_host"]

        assert (boot.code, boot.events) == (STARTUP_FAILED, [NO_SERVER.event])
        assert boot.record(NO_SERVER.event)["file"] == MONGODB_URI_FILE
        assert boot.leaked(Withheld({"host": UNKNOWN_HOST, **UNKNOWN_HOST_URI})) == []


@pytest.mark.db
class TestTheBoot:
    async def test_builds_the_indexes_in_the_database_the_settings_name(self, tmp_path: Path, mongo_replica_set_url: str):
        """A unique index is the one guard against two writes racing for a key, and one built elsewhere guards nothing."""

        database = worker_database("fl_boot_indexes")
        declared = {(collection, index.document["name"]) for collection, index in (*UNIQUE_INDEXES, *SUPPORT_INDEXES, *TTL_INDEXES)}

        client: AsyncMongoClient = new_client(mongo_replica_set_url)
        try:
            await client.drop_database(database)

            async with serving(
                tmp_path, Withheld({MONGODB_URI_FILE: mongo_replica_set_url, **KEYS}), {"DB_BASE_NAME": database}, until="system.started"
            ) as boot:
                pass

            held = client[database]
            indexes = {
                (name, spec["name"])
                for name in await held.list_collection_names()
                for spec in await (await held[name].list_indexes()).to_list(length=None)
            }
        finally:
            await client.drop_database(database)
            await client.close()

        assert "system.started" in boot.events
        assert declared - indexes == set()

    async def test_refused_by_a_duplicate_names_the_index_and_never_the_value(self, tmp_path: Path, mongo_replica_set_url: str):
        """The server's message for a duplicate quotes the duplicated value, and a venue's name passes the address scrub."""

        database = worker_database("fl_boot_duplicate")
        doubled = Withheld({"venue": "Made-Up-Venue-7"})

        client: AsyncMongoClient = new_client(mongo_replica_set_url)
        try:
            await client.drop_database(database)
            await client[database][Collection.SPIELORTE].insert_many([{"name": doubled["venue"]}, {"name": doubled["venue"]}])

            boot = (
                await booted({"duplicate": (tmp_path, Withheld({MONGODB_URI_FILE: mongo_replica_set_url, **KEYS}), {"DB_BASE_NAME": database})})
            )["duplicate"]
        finally:
            await client.drop_database(database)
            await client.close()

        assert (boot.code, boot.events) == (STARTUP_FAILED, ["db.indexes_failed"])
        assert "uniq_spielort_name" in boot.record("db.indexes_failed")["refusal"]
        assert boot.leaked(doubled) == []
