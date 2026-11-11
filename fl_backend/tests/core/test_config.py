import asyncio
import logging
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from pydantic import SecretStr, ValidationError
from pymongo import MongoClient

from app.core import db
from app.core.config import (
    INTERNAL_API_KEY_LENGTH,
    MONGODB_URI_FILE,
    SECRET_FILES,
    BackendConfig,
    EnvironmentValidationError,
    get_config,
)
from app.core.constraints import SUPPORT_INDEXES, TTL_INDEXES, UNIQUE_INDEXES
from app.core.db import NO_SERVER, UNREACHABLE, DatabaseUnreachableError, lifespan
from tests.worker import worker_database

# TEST-NET-1 (RFC 5737) on a port no mongod this repository starts is served on, so the ping fails
# for the one reason these cases are about wherever they run.
UNROUTABLE_HOST = "192.0.2.1"
UNROUTABLE_URI = f"mongodb://{UNROUTABLE_HOST}:27018"


def a_key_the_boot_accepts(prefix: str) -> str:
    """Padded rather than spelled, so the three stay readable in a failure and the length is written once."""
    return prefix.ljust(INTERNAL_API_KEY_LENGTH, "0")


# Spelled as the environment spells them, because the half under test is what reads the environment.
REQUIRED = {
    "DB_BASE_NAME": "frankfurtleague_test",
}

# Named as the secrets directory names them, each holding what a deployment's file would.
FILES = {
    MONGODB_URI_FILE: "mongodb://localhost:27017/frankfurtleague_test",
    "internal_api_key_base": a_key_the_boot_accepts("base"),
    "internal_api_key_system": a_key_the_boot_accepts("system"),
    "internal_api_key_admin": a_key_the_boot_accepts("admin"),
}

# Each credential's field, beside the file it is read from.
SECRET_FIELDS = {
    name: file for name, field in BackendConfig.model_fields.items() if (file := str(field.validation_alias or name)) in SECRET_FILES
}

# Each file's credential under its field's own name, the variable a machine's own shell may still
# carry from before the credentials were files.
VARIABLE_OF = {file: name.upper() for name, file in SECRET_FIELDS.items()}


@pytest.fixture(autouse=True)
def a_cold_settings_cache():
    """`get_config` memoizes, so a case reading the environment would otherwise be answered by whatever an earlier one built."""
    get_config.cache_clear()
    yield
    get_config.cache_clear()


WELL_FORMED: dict[str, Any] = {
    "mongodb_uri": SecretStr("mongodb://localhost:27017/frankfurtleague_test"),
    "db_base_name": "frankfurtleague_test",
    "internal_api_key_base": SecretStr(a_key_the_boot_accepts("base")),
    "internal_api_key_system": SecretStr(a_key_the_boot_accepts("system")),
    "internal_api_key_admin": SecretStr(a_key_the_boot_accepts("admin")),
}


def build(**overrides: Any) -> BackendConfig:
    """Every required field passed, and no dotenv file read, as `tests/config.py :: build_test_config` builds them."""
    values = {**WELL_FORMED, **overrides}
    # The URI under its file's name, the one the class reads it by.
    values[MONGODB_URI_FILE] = values.pop("mongodb_uri")
    return BackendConfig(_env_file=None, **values)


def an_environment(
    monkeypatch: pytest.MonkeyPatch, working_directory: Path, files: Mapping[str, bytes | None] | None = None, **overrides: str
) -> Path:
    """The variables, a secrets directory and a working directory, each holding only what the case put there.

    `get_config` reads all three, so one left standing answers with the machine's own. A file mapped
    to `None` is left out.
    """
    monkeypatch.chdir(working_directory)
    directory = working_directory / "run-secrets"
    directory.mkdir(exist_ok=True)
    # Bytes: a text-mode write would end every file in a carriage return on Windows.
    for name, content in {**{name: value.encode() for name, value in FILES.items()}, **(files or {})}.items():
        if content is not None:
            (directory / name).write_bytes(content)
    monkeypatch.setenv("SECRETS_DIR", str(directory))
    for name, value in {**REQUIRED, **overrides}.items():
        monkeypatch.setenv(name, value)
    return directory


def boot(config: BackendConfig | None = None) -> None:
    """`lifespan` entered as the application enters it: the client is built inside it, so nothing else reaches these refusals."""

    async def enter() -> None:
        # The settings `app/main.py :: create_app` hands the application, the environment's where none are passed.
        app = FastAPI()
        app.state.config = config or get_config()
        async with lifespan(app):
            raise AssertionError("the boot is expected to fail before the application starts")

    asyncio.run(enter())


def refusal(monkeypatch: pytest.MonkeyPatch, working_directory: Path, files: Mapping[str, bytes | None] | None = None, **overrides: str) -> str:
    """What `get_config` refused with over this environment and these files."""
    an_environment(monkeypatch, working_directory, files, **overrides)

    with pytest.raises(EnvironmentValidationError) as raised:
        get_config()

    return str(raised.value)


class TestTheInternalKeys:
    @pytest.mark.parametrize("field", ["internal_api_key_base", "internal_api_key_system", "internal_api_key_admin"])
    @pytest.mark.parametrize("length", [INTERNAL_API_KEY_LENGTH - 1, INTERNAL_API_KEY_LENGTH + 1])
    def test_a_key_of_any_other_length_fails_the_boot(self, field, length):
        """Both bounds: a truncated key answers every internal request 401, and a longer one boots here while the frontend refuses it."""
        with pytest.raises(ValidationError):
            build(**{field: SecretStr("k" * length)})


class TestTheSecretFiles:
    """Each credential is its file's, and only its file's."""

    @pytest.mark.parametrize("file", SECRET_FILES)
    def test_a_directory_missing_one_file_refuses_the_boot_naming_it_whatever_the_environment_carries(self, monkeypatch, tmp_path, file):
        """Over every file the class reads: a credential given a default boots without its file, on a value nobody chose.

        The variable of the credential's own name stands beside the missing file, and stands in for nothing.
        """
        refused = refusal(monkeypatch, tmp_path, {file: None}, **{VARIABLE_OF[file]: FILES[file]})

        assert refused == f"Invalid secret files: {file}"

    def test_a_variable_beside_its_file_leaves_the_files_value_in_effect(self, monkeypatch, tmp_path):
        """pydantic-settings ranks a variable above the secrets directory, so a variable left behind would otherwise win in silence."""
        an_environment(monkeypatch, tmp_path, INTERNAL_API_KEY_BASE=a_key_the_boot_accepts("left-behind"))

        config = get_config()

        assert config.internal_api_key_base.get_secret_value() == FILES["internal_api_key_base"]

    def test_a_refused_value_names_the_file_alone(self, monkeypatch, tmp_path):
        """The URI is the credential, so the scheme check's refusal is the line a password would otherwise ride out on."""
        marker = "hunter2-marker"

        refused = refusal(monkeypatch, tmp_path, {MONGODB_URI_FILE: f"reader:{marker}@localhost:27017".encode()})

        assert refused == f"Invalid secret files: {MONGODB_URI_FILE}"
        assert marker not in refused

    def test_each_field_holds_the_file_secret_files_names_it_by(self, monkeypatch, tmp_path):
        """Every field to its own file, which no other case pins.

        An `env_prefix`, which pydantic-settings puts on a secret file's name too, refuses here.
        """
        an_environment(monkeypatch, tmp_path)

        config = get_config()

        held = {file: getattr(config, name).get_secret_value() for name, file in SECRET_FIELDS.items()}
        assert held == FILES


class TestTheNamesOnlyErrorPath:
    def test_the_refusal_names_the_variables_and_carries_no_rejected_value(self, monkeypatch, tmp_path):
        """The incident's class: a value that reaches the container log is the whole exposure, and a name is all an operator needs."""
        database = "frankfurt league"

        message = refusal(monkeypatch, tmp_path, DB_BASE_NAME=database)

        assert message == "Invalid environment variables: DB_BASE_NAME"
        assert database not in message

    @pytest.mark.parametrize(
        "files,overrides",
        [({}, {"DB_BASE_NAME": "frankfurt league"}), ({MONGODB_URI_FILE: b"localhost:27017"}, {})],
        ids=["a variable", "a secret file"],
    )
    def test_the_pydantic_error_is_suppressed_rather_than_chained(self, monkeypatch, tmp_path, files, overrides):
        """`raise ... from None` is what keeps `input_value=` out of the traceback uvicorn prints, and nothing else in the path does."""
        an_environment(monkeypatch, tmp_path, files, **overrides)

        with pytest.raises(EnvironmentValidationError) as raised:
            get_config()

        assert raised.value.__cause__ is None
        assert raised.value.__suppress_context__

    def test_a_file_the_reader_cannot_decode_refuses_with_the_failure_type_alone(self, monkeypatch, tmp_path):
        """The other way out of the build: the dotenv read fails before any field is judged.

        No `ValidationError` exists to name a variable, and the raw exception quotes the file's own
        bytes.
        """
        (tmp_path / ".env").write_bytes(b"DB_BASE_NAME=\xff\xfe\n")
        an_environment(monkeypatch, tmp_path)

        with pytest.raises(EnvironmentValidationError) as raised:
            get_config()

        assert str(raised.value) == "The environment could not be read: UnicodeDecodeError"
        assert raised.value.__cause__ is None
        assert raised.value.__suppress_context__

    def test_a_secret_file_the_reader_cannot_decode_refuses_with_the_failure_type_alone(self, monkeypatch, tmp_path):
        """Its decode error quotes the bytes it choked on, which are the credential's."""
        directory = an_environment(monkeypatch, tmp_path, {"internal_api_key_base": b"\xff\xfe" + a_key_the_boot_accepts("base").encode()})

        with pytest.raises(EnvironmentValidationError) as raised:
            get_config()

        assert str(raised.value) == f"Unreadable secret files: {directory / 'internal_api_key_base'} (UnicodeDecodeError)"


class TestANameTheClassDoesNotDeclare:
    def test_a_misspelling_in_the_environment_file_fails_the_boot(self, monkeypatch, tmp_path):
        """`extra="forbid"` is what this refuses: under `ignore` a misspelled name reads as an omission."""
        (tmp_path / ".env").write_bytes(b"# a comment\n\nDB_BASE_NAMES=frankfurtleague\n")

        assert refusal(monkeypatch, tmp_path) == "Undeclared environment variables: 1"

    def test_a_key_s_line_keeping_the_dotenv_shape_is_counted_and_never_named(self, monkeypatch, tmp_path):
        """A pasted key's line declares its own text as a name, so an undeclared name is the file's text and never printed."""
        (tmp_path / ".env").write_bytes(b"KEYDATAvxq==\n# a comment\nKEYDATAvxr==\n")

        refused = refusal(monkeypatch, tmp_path, DB_BASE_NAME="frankfurt league")

        assert refused == "Invalid environment variables: DB_BASE_NAME; Undeclared environment variables: 2"
        assert "vxq" not in refused.lower()


class TestTheStartupPing:
    def test_a_server_that_cannot_be_reached_names_the_file_and_not_the_host(self, monkeypatch, tmp_path, caplog):
        """Driven through the files, which `get_config` reads for the settings the boot builds its client from."""
        an_environment(monkeypatch, tmp_path, {MONGODB_URI_FILE: UNROUTABLE_URI.encode()})
        # The ping fails for the one reason these cases are about, sooner than the boot's own wait.
        monkeypatch.setattr(db, "SERVER_SELECTION_TIMEOUT_MS", 200)

        with caplog.at_level(logging.CRITICAL):
            with pytest.raises(DatabaseUnreachableError) as raised:
                boot()

        assert str(raised.value) == UNREACHABLE.sentence
        assert UNROUTABLE_HOST not in caplog.text
        assert getattr(caplog.records[-1], "file", None) == MONGODB_URI_FILE

    def test_a_uri_the_scheme_check_passes_and_the_driver_cannot_open_names_the_file(self, monkeypatch, tmp_path, caplog):
        """A truncated value: the driver refuses it while the client is CONSTRUCTED, so a handler around the ping alone never sees it."""
        an_environment(monkeypatch, tmp_path, {MONGODB_URI_FILE: b"mongodb://"})

        with caplog.at_level(logging.CRITICAL):
            with pytest.raises(DatabaseUnreachableError) as raised:
                boot()

        assert str(raised.value) == NO_SERVER.sentence
        assert getattr(caplog.records[-1], "file", None) == MONGODB_URI_FILE
        # The line's key is what an operator greps a boot failure by.
        assert caplog.records[-1].getMessage() == NO_SERVER.event


def booted(config: BackendConfig) -> None:
    """`lifespan` entered and left cleanly, so the constraints it applies on the way in have landed."""

    async def enter() -> None:
        app = FastAPI()
        app.state.config = config
        async with lifespan(app):
            pass

    asyncio.run(enter())


@pytest.mark.db
class TestTheBootAppliesTheIndexesWhereTheApplicationServes:
    def test_the_indexes_land_in_the_database_the_settings_name(self, monkeypatch, tmp_path, mongo_url: str):
        """The environment names a second database on the same server, so a boot reading it applies there instead."""
        built_name, environment_name = worker_database("fl_boot_built"), worker_database("fl_boot_environment")
        an_environment(monkeypatch, tmp_path, {MONGODB_URI_FILE: mongo_url.encode()}, DB_BASE_NAME=environment_name)

        client: MongoClient = MongoClient(mongo_url)
        try:
            for name in (built_name, environment_name):
                client.drop_database(name)

            booted(build(mongodb_uri=SecretStr(mongo_url), db_base_name=built_name))

            declared = {(index.collection, index.name) for index in (*UNIQUE_INDEXES, *SUPPORT_INDEXES, *TTL_INDEXES)}
            database = client[built_name]
            built = {(name, spec["name"]) for name in database.list_collection_names() for spec in database[name].list_indexes()}
            assert (declared - built, client[environment_name].list_collection_names()) == (set(), [])
        finally:
            for name in (built_name, environment_name):
                client.drop_database(name)
            client.close()
