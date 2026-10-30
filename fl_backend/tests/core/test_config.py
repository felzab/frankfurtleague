import asyncio
import base64
import errno
import logging
import secrets
import warnings
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from pydantic import Field, SecretStr, ValidationError
from pymongo import MongoClient
from pymongo.errors import ConfigurationError, InvalidURI, OperationFailure, ServerSelectionTimeoutError

from app.core import db
from app.core.config import (
    INTERNAL_API_KEY_LENGTH,
    MONGODB_URI_FILE,
    SECRET_FILES,
    SPERRLISTE_KEY_MIN_LENGTH,
    BackendConfig,
    EnvironmentValidationError,
    get_config,
    read_environment,
)
from app.core.constraints import SUPPORT_INDEXES, TTL_INDEXES, UNIQUE_INDEXES
from app.core.db import NO_SERVER, REJECTED, UNREACHABLE, DatabaseUnreachableError, _refusal_for, lifespan
from tests.worker import worker_database

# TEST-NET-1 (RFC 5737) on a port no mongod this repository starts is served on, so the ping fails
# for the one reason these cases are about wherever they run.
UNROUTABLE_HOST = "192.0.2.1"
UNROUTABLE_URI = f"mongodb://{UNROUTABLE_HOST}:27018"


def a_key_the_boot_accepts(prefix: str) -> str:
    """Padded rather than spelled, so the three stay readable in a failure and the length is written once."""
    return prefix.ljust(INTERNAL_API_KEY_LENGTH, "0")


# Its own padding rather than the helper above: the two floors are separate decisions, and one
# helper would make a change to either silently move the other's fixtures.
BAN_LIST_KEY = "ban-list".ljust(SPERRLISTE_KEY_MIN_LENGTH, "0")

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
    "sperrliste_key": BAN_LIST_KEY,
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
    "sperrliste_key": SecretStr(BAN_LIST_KEY),
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
    # Bytes (CLAUDE.md §6): a text-mode write would end every file in a carriage return on Windows.
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


class TestDatabaseBaseName:
    @pytest.mark.parametrize("value", ["frankfurtleague", "frankfurtleague_test_gw0", "frankfurt-league"])
    def test_a_name_mongodb_accepts_is_accepted(self, value):
        assert build(db_base_name=value).db_base_name == value

    @pytest.mark.parametrize("value", ["", "frankfurt/league", "frankfurt league", "frankfurtleague$"])
    def test_a_name_mongodb_refuses_fails_the_boot(self, value):
        with pytest.raises(ValidationError):
            build(db_base_name=value)


class TestMongodbUri:
    @pytest.mark.parametrize("value", ["mongodb://localhost:27017", "mongodb+srv://cluster.example.net/frankfurtleague"])
    def test_both_driver_schemes_are_accepted(self, value):
        assert build(mongodb_uri=SecretStr(value)).mongodb_uri.get_secret_value() == value

    @pytest.mark.parametrize("value", ["", "localhost:27017", "https://localhost:27017"])
    def test_anything_the_driver_could_not_open_fails_the_boot(self, value):
        with pytest.raises(ValidationError):
            build(mongodb_uri=SecretStr(value))


class TestTheInternalKeys:
    @pytest.mark.parametrize("field", ["internal_api_key_base", "internal_api_key_system", "internal_api_key_admin"])
    @pytest.mark.parametrize("length", [INTERNAL_API_KEY_LENGTH - 1, INTERNAL_API_KEY_LENGTH + 1])
    def test_a_key_of_any_other_length_fails_the_boot(self, field, length):
        """Both bounds: a truncated key answers every internal request 401, and a longer one boots here while the frontend refuses it."""
        with pytest.raises(ValidationError):
            build(**{field: SecretStr("k" * length)})

    @pytest.mark.parametrize("field", ["internal_api_key_base", "internal_api_key_system", "internal_api_key_admin"])
    @pytest.mark.parametrize("odd_character", ["ü", "\U0001f600", " ", "\x7f"], ids=["non-ascii", "astral", "space", "delete"])
    def test_a_key_of_the_right_length_carrying_a_non_ascii_character_or_a_space_fails_the_boot(self, field, odd_character):
        """What the length alone admits: `compare_digest` RAISES on the first two, and the astral one is also 65 units to the frontend.

        The space and DEL sit either side of the class's range.
        """
        key = odd_character + "k" * (INTERNAL_API_KEY_LENGTH - 1)

        assert len(key) == INTERNAL_API_KEY_LENGTH

        with pytest.raises(ValidationError):
            build(**{field: SecretStr(key)})

    @pytest.mark.parametrize("field", ["internal_api_key_base", "internal_api_key_system", "internal_api_key_admin"])
    @pytest.mark.parametrize(
        "generated",
        [
            secrets.token_hex(INTERNAL_API_KEY_LENGTH // 2),
            base64.b64encode(secrets.token_bytes(47)).decode()[:INTERNAL_API_KEY_LENGTH],
            base64.b64encode(secrets.token_bytes(46)).decode()[: INTERNAL_API_KEY_LENGTH - 2] + "==",
            secrets.token_urlsafe(48),
        ],
        ids=["openssl-hex", "base64", "base64-padded", "token-urlsafe"],
    )
    def test_a_key_each_named_generator_makes_boots(self, field, generated):
        """`openssl rand -hex 32` is `docs/ops/runbooks.md` §16's; base64 and `token_urlsafe` are the other two in reach.

        The class refusing any of their characters would refuse a key none of the readers alters.
        """
        assert len(generated) == INTERNAL_API_KEY_LENGTH

        assert getattr(build(**{field: SecretStr(generated)}), field).get_secret_value() == generated


class TestTheBanListKey:
    def test_a_key_carrying_a_value_is_never_echoed_by_the_refusal_beside_it(self, monkeypatch, tmp_path):
        """A rejected key reaching the container log is the whole exposure, and the value here is the one this gate would leak."""
        short = "x" * (SPERRLISTE_KEY_MIN_LENGTH - 1)

        refused = refusal(monkeypatch, tmp_path, {"sperrliste_key": short.encode()})

        assert refused == "Invalid secret files: sperrliste_key"
        assert short not in refused

    def test_a_key_under_the_floor_fails_the_boot(self):
        """The boot is the last cheap moment: the key can never be rotated, every stored hash having been taken under it."""
        with pytest.raises(ValidationError):
            build(sperrliste_key=SecretStr("k" * (SPERRLISTE_KEY_MIN_LENGTH - 1)))

    def test_a_key_at_the_floor_boots(self):
        """The boundary, or a floor written one past its intent refuses the value the runbook tells an operator to generate."""
        at_the_floor = "k" * SPERRLISTE_KEY_MIN_LENGTH

        assert build(sperrliste_key=SecretStr(at_the_floor)).sperrliste_key.get_secret_value() == at_the_floor

    def test_a_longer_key_boots(self):
        """No ceiling, deliberately: HMAC takes a key of any length, and one here would refuse a passphrase for nothing."""
        longer = "k" * (SPERRLISTE_KEY_MIN_LENGTH * 2)

        assert build(sperrliste_key=SecretStr(longer)).sperrliste_key.get_secret_value() == longer


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

    def test_a_file_ending_in_a_line_break_reads_without_it(self, monkeypatch, tmp_path):
        """A file written by an editor or `echo` ends in one, and a key carrying it would match nothing the frontend sends."""
        key = a_key_the_boot_accepts("stripped")
        an_environment(monkeypatch, tmp_path, {"internal_api_key_base": f"{key}\r\n".encode()})

        assert get_config().internal_api_key_base.get_secret_value() == key

    def test_a_refused_value_names_the_file_alone(self, monkeypatch, tmp_path):
        """The URI is the credential, so the scheme check's refusal is the line a password would otherwise ride out on."""
        marker = "hunter2-marker"

        refused = refusal(monkeypatch, tmp_path, {MONGODB_URI_FILE: f"reader:{marker}@localhost:27017".encode()})

        assert refused == f"Invalid secret files: {MONGODB_URI_FILE}"
        assert marker not in refused

    def test_an_unreadable_file_refuses_naming_its_path_and_errno_and_never_its_content(self, monkeypatch, tmp_path, capsys):
        """The read raising as it does without the permission to read, on any platform the suite runs on.

        A file mode cannot deny the read on Windows, so the refusal is raised where the file system raises it.
        """
        marker = a_key_the_boot_accepts("unreadable-marker")
        directory = an_environment(monkeypatch, tmp_path, {"internal_api_key_admin": marker.encode()})
        unreadable = directory / "internal_api_key_admin"
        read_text = Path.read_text

        def refusing(path: Path, *args: Any, **kwargs: Any) -> str:
            if path == unreadable:
                raise PermissionError(errno.EACCES, "Permission denied", str(path))
            return read_text(path, *args, **kwargs)

        monkeypatch.setattr(Path, "read_text", refusing)

        with pytest.raises(EnvironmentValidationError) as raised:
            get_config()

        assert str(raised.value) == f"Unreadable secret files: {unreadable} (EACCES)"
        assert raised.value.__cause__ is None and raised.value.__suppress_context__
        assert marker not in str(raised.value) + "".join(capsys.readouterr())

    def test_every_unreadable_file_is_named_beside_every_missing_or_blank_one(self, monkeypatch, tmp_path):
        """The source stops at the first read that fails, so one boot would otherwise name one fault per restart."""
        directory = an_environment(monkeypatch, tmp_path, {MONGODB_URI_FILE: None, "sperrliste_key": b" \r\n"})
        unreadable = [directory / "internal_api_key_base", directory / "internal_api_key_admin"]
        read_text = Path.read_text

        def refusing(path: Path, *args: Any, **kwargs: Any) -> str:
            if path in unreadable:
                raise PermissionError(errno.EACCES, "Permission denied", str(path))
            return read_text(path, *args, **kwargs)

        monkeypatch.setattr(Path, "read_text", refusing)

        with pytest.raises(EnvironmentValidationError) as raised:
            get_config()

        assert str(raised.value) == (
            f"Unreadable secret files: {unreadable[0]} (EACCES), {unreadable[1]} (EACCES); "
            f"Invalid secret files: {MONGODB_URI_FILE}, sperrliste_key"
        )

    def test_every_missing_or_blank_file_is_named_where_none_is_unreadable(self, monkeypatch, tmp_path):
        refused = refusal(monkeypatch, tmp_path, {MONGODB_URI_FILE: None, "internal_api_key_system": b"", "sperrliste_key": b" \r\n"})

        assert refused == f"Invalid secret files: {MONGODB_URI_FILE}, internal_api_key_system, sperrliste_key"

    def test_a_directory_standing_at_a_files_path_refuses_naming_that_path(self, monkeypatch, tmp_path):
        """What Docker leaves where a bind mount's source file was missing, and a warning alone in the library."""
        directory = an_environment(monkeypatch, tmp_path, {"internal_api_key_system": None})
        (directory / "internal_api_key_system").mkdir()

        with pytest.raises(EnvironmentValidationError) as raised:
            get_config()

        assert str(raised.value) == f"Unreadable secret files: {directory / 'internal_api_key_system'} (EISDIR)"

    @pytest.mark.parametrize("shape,reason", [("missing", "ENOENT"), ("a file", "ENOTDIR")])
    def test_a_directory_that_is_none_refuses_naming_it_and_warns_nothing(self, monkeypatch, tmp_path, shape, reason):
        """The missing one is load-bearing: the library only warns there, and a warning leaves outside the log envelope."""
        an_environment(monkeypatch, tmp_path)
        named = tmp_path / "nowhere"
        if shape == "a file":
            named.write_bytes(b"")
        monkeypatch.setenv("SECRETS_DIR", str(named))

        with warnings.catch_warnings(record=True) as caught, pytest.raises(EnvironmentValidationError) as raised:
            warnings.simplefilter("always")
            get_config()

        assert str(raised.value) == f"Unreadable secret files: {named} ({reason})"
        assert [str(warning.message) for warning in caught] == []

    def test_a_file_nothing_declares_is_never_read(self, monkeypatch, tmp_path):
        """In development one directory holds both services' files and the signing key, which the backend must not refuse."""
        an_environment(monkeypatch, tmp_path, {"auth_secret": b"the frontend's", "fl_actor_signing_key": b"-----BEGIN PRIVATE KEY-----"})

        assert get_config().db_base_name == REQUIRED["DB_BASE_NAME"]

    def test_the_preflight_opens_no_secret_file(self, monkeypatch, tmp_path):
        """It runs in a container that mounts none (`scripts/ops/deploy.sh :: ENV_NAME_CHECK`), its missing credentials no refusal."""
        an_environment(monkeypatch, tmp_path)
        monkeypatch.setenv("SECRETS_DIR", str(tmp_path / "nowhere"))

        assert read_environment() is None

    def test_the_preflight_names_a_refused_credential_line_as_the_variable_it_is(self, monkeypatch, tmp_path):
        """No file was read, so the value came from the environment or the dotenv file, which is where the operator looks."""
        an_environment(monkeypatch, tmp_path, INTERNAL_API_KEY_BASE="short")
        monkeypatch.setenv("SECRETS_DIR", str(tmp_path / "nowhere"))

        with pytest.raises(EnvironmentValidationError) as raised:
            read_environment()

        assert str(raised.value) == "Invalid environment variables: INTERNAL_API_KEY_BASE"

    def test_every_declared_file_is_one_the_directory_is_handed(self):
        """The fixture above writes exactly the files the class reads, so a field added without a file fails here first."""
        assert sorted(SECRET_FILES) == sorted(FILES)

    def test_each_field_holds_the_file_secret_files_names_it_by(self, monkeypatch, tmp_path):
        """Every field to its own file, which no other case pins.

        An `env_prefix`, which pydantic-settings puts on a secret file's name too, refuses here.
        """
        an_environment(monkeypatch, tmp_path)

        config = get_config()

        held = {file: getattr(config, name).get_secret_value() for name, file in SECRET_FIELDS.items()}
        assert held == FILES

    @pytest.mark.parametrize(("field", "file"), [(name, file) for name, file in SECRET_FIELDS.items() if name != file])
    def test_no_file_under_an_aliased_fields_own_name_stands_in_for_its_own(self, monkeypatch, tmp_path, field, file):
        """The library reads it under `validate_by_name` or `populate_by_name`, and the compose check holds nothing to it."""
        refused = refusal(monkeypatch, tmp_path, {file: None, field: FILES[file].encode()})

        assert refused == f"Invalid secret files: {file}"

    def test_a_missing_file_and_a_refused_value_are_named_together(self, monkeypatch, tmp_path):
        """The missing file is the preflight's to see and the short key the build's, so one restart shows both."""
        refused = refusal(monkeypatch, tmp_path, {"internal_api_key_admin": None, "sperrliste_key": b"short"})

        assert refused == "Invalid secret files: internal_api_key_admin, sperrliste_key"

    # The cases below lend the boot a subclass of the settings under an option the shipped class
    # leaves alone, so the library's own lookup, stand-ins included, is what the preflight is held to.

    def test_a_missing_file_is_refused_where_the_library_reads_a_stand_in_for_it(self, monkeypatch, tmp_path):
        """Under `validate_by_name` the library builds from a file under the field's own name, which the compose check holds nothing to."""

        class ByName(BackendConfig, validate_by_name=True):
            pass

        monkeypatch.setattr("app.core.config.BackendConfig", ByName)

        refused = refusal(monkeypatch, tmp_path, {MONGODB_URI_FILE: None, "mongodb_uri": FILES[MONGODB_URI_FILE].encode()})

        assert refused == f"Invalid secret files: {MONGODB_URI_FILE}"

    def test_a_file_in_a_letter_case_the_library_would_not_find_is_missing(self, monkeypatch, tmp_path):
        """The library's own `case_sensitive`: a preflight finding the upper-cased file would let the stand-in beside it boot."""

        class Spelled(BackendConfig, validate_by_name=True, case_sensitive=True):
            pass

        monkeypatch.setattr("app.core.config.BackendConfig", Spelled)
        value = FILES[MONGODB_URI_FILE].encode()

        # The option binds the variables too, outside Windows, whose environment the library reads
        # case-insensitively whatever it is set to: the base name spelled as the field is.
        refused = refusal(
            monkeypatch,
            tmp_path,
            {MONGODB_URI_FILE: None, MONGODB_URI_FILE.upper(): value, "mongodb_uri": value},
            db_base_name=REQUIRED["DB_BASE_NAME"],
        )

        assert refused == f"Invalid secret files: {MONGODB_URI_FILE}"

    def test_a_missing_file_whose_field_has_a_default_boots_on_the_default(self, monkeypatch, tmp_path):
        """No secret field carries one, so one is lent: `scripts/checks/check_compose_model.py :: backend_files` lets its file go unmounted."""
        lent = "lent".ljust(SPERRLISTE_KEY_MIN_LENGTH, "0")

        class Defaulted(BackendConfig):
            sperrliste_key: SecretStr = Field(default=SecretStr(lent), min_length=SPERRLISTE_KEY_MIN_LENGTH)

        monkeypatch.setattr("app.core.config.BackendConfig", Defaulted)
        an_environment(monkeypatch, tmp_path, {"sperrliste_key": None})

        assert get_config().sperrliste_key.get_secret_value() == lent


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
        directory = an_environment(monkeypatch, tmp_path, {"sperrliste_key": b"\xff\xfe" + BAN_LIST_KEY.encode()})

        with pytest.raises(EnvironmentValidationError) as raised:
            get_config()

        assert str(raised.value) == f"Unreadable secret files: {directory / 'sperrliste_key'} (UnicodeDecodeError)"

    def test_a_well_formed_environment_still_builds(self, monkeypatch, tmp_path):
        an_environment(monkeypatch, tmp_path)

        assert get_config().db_base_name == REQUIRED["DB_BASE_NAME"]


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

    def test_a_variable_the_host_carries_for_something_else_still_boots(self, monkeypatch, tmp_path):
        """The population `forbid` must not reach: every host's environment carries names no settings class declares.

        A name the settings no longer declare, left in the container's environment, is one of these.
        """
        an_environment(monkeypatch, tmp_path, PATH_TO_NOTHING="a value nothing here declares", ACTOR_TOKEN_PUBLIC_KEY="left-behind")

        assert get_config().db_base_name == REQUIRED["DB_BASE_NAME"]

    def test_the_class_the_suite_builds_reads_no_source_at_all(self, monkeypatch, tmp_path):
        """A settings class that read one would be green on CI and red on a developer's machine alone."""
        (tmp_path / ".env").write_bytes(b"DB_BASE_NAMES=misspelled\n")
        an_environment(
            monkeypatch, tmp_path, {"internal_api_key_base": a_key_the_boot_accepts("from-a-file").encode()}, DB_BASE_NAME="elsewhere"
        )

        config = build()

        assert config.db_base_name == WELL_FORMED["db_base_name"]
        assert config.internal_api_key_base == WELL_FORMED["internal_api_key_base"]


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

    def test_the_boot_opens_the_settings_the_application_was_built_with(self, monkeypatch, tmp_path, caplog):
        """Never the files': an application built with other settings would serve one database and boot against another."""
        an_environment(monkeypatch, tmp_path, {MONGODB_URI_FILE: b"mongodb://"})
        monkeypatch.setattr(db, "SERVER_SELECTION_TIMEOUT_MS", 200)

        with caplog.at_level(logging.CRITICAL):
            with pytest.raises(DatabaseUnreachableError) as raised:
                boot(build(mongodb_uri=SecretStr(UNROUTABLE_URI)))

        # The file's truncated value would have answered `NO_SERVER`.
        assert str(raised.value) == UNREACHABLE.sentence

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


class TestWhichRefusalACauseEarns:
    @pytest.mark.parametrize(
        "error,expected",
        [
            (OperationFailure("Authentication failed."), REJECTED),
            (InvalidURI("Invalid URI scheme"), NO_SERVER),
            (ConfigurationError("the SRV record could not be resolved"), NO_SERVER),
            (ValueError("Port must be an integer between 0 and 65535"), NO_SERVER),
            (ServerSelectionTimeoutError("no server available"), UNREACHABLE),
            (RuntimeError("a class the driver's own hierarchy does not cover"), UNREACHABLE),
        ],
    )
    def test_each_cause_gets_the_sentence_its_operator_action_needs(self, error, expected):
        """Three actions, three sentences. The `ValueError` case is load-bearing: a mistyped port leaves the driver's own hierarchy."""
        assert _refusal_for(error) == expected

    def test_every_refusal_opens_with_the_file(self):
        """One opening for the three, so an operator who greps the file's name is handed whichever of them the boot raised."""
        assert all(refusal.sentence.startswith(f"{MONGODB_URI_FILE}: ") for refusal in (UNREACHABLE, NO_SERVER, REJECTED))

    def test_no_two_refusals_share_a_key(self):
        """A key copied onto a second sentence answers a grep with the other incident, which is worse than no key at all."""
        events = [refusal.event for refusal in (UNREACHABLE, NO_SERVER, REJECTED)]

        assert len(set(events)) == len(events)
