import errno
import os
import re
import warnings
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Final

from fastapi import Request
from pydantic import AfterValidator, BaseModel, Field, SecretStr, ValidationError, ValidationInfo, field_validator
from pydantic_core import ErrorDetails
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SecretsSettingsSource, SettingsConfigDict, SettingsError

# The length the frontend pins each internal key to. An equality rather than a floor: the pair only
# works when the two values are identical, so a key one side alone would refuse is a deployment
# already broken.
INTERNAL_API_KEY_LENGTH: Final = 64

# RFC 9110's `VCHAR`, which a header carries as written: the guard's `secrets.compare_digest` raises
# on a non-ASCII `str`. The frontend pins the same characters.
INTERNAL_API_KEY_CHARACTERS = re.compile(r"[\x21-\x7e]+")

# Where Compose mounts a file secret, which is where a container finds it with nothing set.
DEFAULT_SECRETS_DIR: Final = "/run/secrets"

# Prefixed because the frontend holds a different login under `frontend_mongodb_uri`, and one file
# name is spelled the same on the host and in the container.
MONGODB_URI_FILE: Final = "backend_mongodb_uri"


def _only_key_characters(key: SecretStr) -> SecretStr:
    """A validator rather than `Field(pattern=)`, which pydantic refuses to apply to a `SecretStr`."""
    if INTERNAL_API_KEY_CHARACTERS.fullmatch(key.get_secret_value()) is None:
        raise ValueError("printable ASCII only, with no space")
    return key


InternalAPIKey = Annotated[
    SecretStr,
    Field(min_length=INTERNAL_API_KEY_LENGTH, max_length=INTERNAL_API_KEY_LENGTH),
    AfterValidator(_only_key_characters),
]


class EnvironmentValidationError(Exception):
    """The settings refused, naming variables, secret files or a failure type, and nothing else.

    Its own type rather than pydantic's: a `ValidationError` renders `input_value=`, so one reaching
    the container log publishes the value that was rejected.
    """


# The issue pydantic raises for a name the dotenv file holds and the class does not declare.
UNDECLARED: Final = "extra_forbidden"


# Parsed rather than imported by the check holding the compose files to these fields: a file named by
# any shape but a string or a module constant refuses there.
class _SecretFields(BaseModel):
    """The credentials, each read from its own file under `SECRETS_DIR`."""

    mongodb_uri: SecretStr = Field(validation_alias=MONGODB_URI_FILE, description="MongoDB Connection URI")

    internal_api_key_base: InternalAPIKey = Field(description="Base internal API-key")
    internal_api_key_system: InternalAPIKey = Field(description="Internal API-key for the system router")
    internal_api_key_admin: InternalAPIKey = Field(description="Internal API-key for the routers a signed-in person or an administrator calls")

    # Against each key declared above, which `info.data` holds once it passed: two tiers holding one key are one tier,
    # every holder of the lower key reaching the other's routes. Refused at the later key, so the refusal names a file.
    @field_validator("internal_api_key_system", "internal_api_key_admin")
    def validate_distinct_key(cls, key: SecretStr, info: ValidationInfo) -> SecretStr:
        if key in (info.data.get("internal_api_key_base"), info.data.get("internal_api_key_system")):
            raise ValueError("holds another internal key's value")
        return key

    @field_validator("mongodb_uri")
    def validate_mongodb_uri(cls, value: SecretStr) -> SecretStr:
        uri = value.get_secret_value()
        if not (uri.startswith("mongodb://") or uri.startswith("mongodb+srv://")):
            raise ValueError("MongoDB URI must start with 'mongodb://' or 'mongodb+srv://'")
        return value


SECRET_FILES: Final = tuple(str(field.validation_alias or name) for name, field in _SecretFields.model_fields.items())


class BackendConfig(BaseSettings, _SecretFields):
    """The settings: each credential from its own file, every other value from the environment or the package's dotenv file.

    Built without `_secrets_dir`, it opens no secret file: `get_config` hands it the directory `SECRETS_DIR` names.
    """

    # The characters MongoDB accepts in a database name: a value carrying a separator or a space
    # would otherwise open a namespace no other tool on this host can name.
    db_base_name: str = Field(pattern=r"^[A-Za-z0-9_-]+$", description="Base DB name")

    # The image's version from its build argument, which the start-up line logs; unset in a run outside an image, and
    # empty, so read as unset, in a build handed none.
    app_version: str | None = Field(default=None, min_length=1, description="The image's version")

    model_config = SettingsConfigDict(
        # The package's file, the one compose lists, so a run from `fl_backend/` reads what compose hands
        # the container. A container has no file: compose hands it the names as variables.
        env_file=".env",
        env_file_encoding="utf-8",
        # `forbid`, because a class that drops a key cannot tell a typo from an omission, and the shipped
        # default serves production. Only the dotenv source hands this class an undeclared name, and it
        # drops one carrying no value.
        extra="forbid",
        # An empty variable reads as unset: an image built without an argument carries its `ENV` as the
        # empty string, which Docker cannot leave unset. A secret file is judged as written either way.
        env_ignore_empty=True,
    )

    # Declared, or a type checker reads the fields as the constructor's arguments and demands the
    # required ones, which the sources supply; `_secrets_dir` and `_env_file` are the library's own.
    def __init__(self, **values: Any) -> None:
        super().__init__(**values)

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        # The secret files above the environment, "the order of the returned callables decides the
        # priority of inputs" (https://pydantic.dev/docs/validation/latest/concepts/pydantic_settings/):
        # the default ranks a variable above its file, so one left behind would win in silence.
        return init_settings, file_secret_settings, env_settings, dotenv_settings


def _refusal(issues: list[ErrorDetails], *, files: set[str]) -> EnvironmentValidationError:
    """Each failing variable upper-cased as the environment spells it, a count of the undeclared, and each failing file by name.

    A failing credential is named by its file. An issue's own message and its `input_value` each quote
    what was rejected, so neither is read. An undeclared name is the file's own text, which a pasted
    key's line keeping the dotenv shape would be, so it is counted and nothing names it. The first
    sentence is the frontend gate's too, so an operator reading either service's refusal reads one
    wording.
    """
    # `<unknown>` mirrors the frontend gate's answer for a locationless issue.
    failing = {str(issue["loc"][0]) if issue["loc"] else "<unknown>" for issue in issues if issue["type"] != UNDECLARED}
    read_from_files = failing & set(SECRET_FILES)
    variables = sorted(failing - read_from_files)
    files = files | read_from_files
    undeclared = sum(issue["type"] == UNDECLARED for issue in issues)

    sentences = [f"Invalid environment variables: {', '.join(name.upper() for name in variables)}"] if variables else []
    if undeclared:
        sentences.append(f"Undeclared environment variables: {undeclared}")
    if files:
        sentences.append(f"Invalid secret files: {', '.join(sorted(files))}")
    return EnvironmentValidationError("; ".join(sentences))


def _absent(directory: Path) -> set[str]:
    """Each secret file the directory lacks, which a variable of its name stands in for without a word from the library."""
    return {name for name in SECRET_FILES if SecretsSettingsSource.find_case_path(directory, name, case_sensitive=False) is None}


def _unreadable(failure: BaseException, directory: Path) -> EnvironmentValidationError:
    """A failed read as `<path> (<errno>)` where the failure carries both, by its type otherwise: never its text, which can quote a file.

    The source wraps what a file's read raised, a warning included: the one it raises is its word for a directory at a
    file's path, what Docker leaves where a bind mount's source file was missing.
    """
    if isinstance(failure, SettingsError) and failure.__cause__ is not None:
        failure = failure.__cause__
    if isinstance(failure, Warning):
        found = (SecretsSettingsSource.find_case_path(directory, name, case_sensitive=False) for name in SECRET_FILES)
        paths = [f"{path} (EISDIR)" for path in found if path is not None and path.is_dir()]
    elif isinstance(failure, OSError) and failure.filename is not None:
        paths = [f"{failure.filename} ({errno.errorcode.get(failure.errno or 0, type(failure).__name__)})"]
    else:
        paths = []
    if paths:
        return EnvironmentValidationError(f"Unreadable secret files: {', '.join(paths)}")
    return EnvironmentValidationError(f"The environment could not be read: {type(failure).__name__}")


@lru_cache
def get_config() -> BackendConfig:
    """The settings, built once and reused, the credentials read from the directory `SECRETS_DIR` names.

    A function rather than a module-level instance, which would make importing any module touching
    configuration read the environment as a side effect.
    """
    # Read before the build, which takes the directory as an argument: the settings loader is the one
    # reader of the environment the ban permits.
    directory = Path(os.environ.get("SECRETS_DIR", DEFAULT_SECRETS_DIR))  # noqa: TID251
    # Asked first: the source only warns for a missing directory, and no warning's text is logged.
    if not directory.is_dir():
        raise EnvironmentValidationError(f"Unreadable secret files: {directory} ({'ENOTDIR' if directory.exists() else 'ENOENT'})")
    try:
        # Raised rather than printed: a warning leaves outside the log envelope.
        with warnings.catch_warnings(action="error"):
            config = BackendConfig(_secrets_dir=directory)
    except ValidationError as error:
        # Every present value judged, and every missing file named whatever stood in for it.
        raise _refusal(error.errors(), files=_absent(directory)) from None
    except (SettingsError, Warning, OSError, ValueError) as failure:
        # Below `ValidationError`'s arm, which is a `ValueError` too, as `SettingsError` is: the dotenv read's
        # `UnicodeDecodeError` reaches this arm unwrapped.
        raise _unreadable(failure, directory) from None
    if absent := _absent(directory):
        raise _refusal([], files=absent) from None
    return config


def get_app_config(request: Request) -> BackendConfig:
    """The settings the application was built with, read per request rather than from `get_config`.

    Held on the application, so one built with other settings answers with them and no dependency is
    replaced to make it do so.
    """
    return request.app.state.config
