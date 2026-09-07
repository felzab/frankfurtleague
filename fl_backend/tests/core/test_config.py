import asyncio
import logging
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from pydantic import SecretStr, ValidationError
from pymongo.errors import ConfigurationError, InvalidURI, OperationFailure, ServerSelectionTimeoutError

from app.core.config import INTERNAL_API_KEY_LENGTH, BackendConfig, EnvironmentValidationError, get_config
from app.core.db import NO_SERVER, REJECTED, UNREACHABLE, DatabaseUnreachableError, _refusal_for, lifespan

# TEST-NET-1 (RFC 5737) on a port no mongod this repository starts is served on, so the ping fails
# for the one reason these cases are about wherever they run.
UNROUTABLE_URI = "mongodb://192.0.2.1:27018"


def a_key_the_boot_accepts(prefix: str) -> str:
    """Padded rather than spelled, so the three stay readable in a failure and the length is written once."""
    return prefix.ljust(INTERNAL_API_KEY_LENGTH, "0")


# Spelled as the environment spells them, because the gate under test is what reads the environment.
REQUIRED = {
    "API_TRUSTED_HOSTS": "testserver,localhost",
    "API_CORS_ALLOWED_ORIGINS": "http://localhost:3000",
    "MONGODB_URI": "mongodb://localhost:27017/frankfurtleague_test",
    "DB_BASE_NAME": "frankfurtleague_test",
    "INTERNAL_API_KEY_BASE": a_key_the_boot_accepts("base"),
    "INTERNAL_API_KEY_SYSTEM": a_key_the_boot_accepts("system"),
    "INTERNAL_API_KEY_ADMIN": a_key_the_boot_accepts("admin"),
}


@pytest.fixture(autouse=True)
def a_cold_settings_cache():
    """`get_config` memoizes, so a case reading the environment would otherwise be answered by whatever an earlier one built."""
    get_config.cache_clear()
    yield
    get_config.cache_clear()


WELL_FORMED: dict[str, Any] = {
    "api_trusted_hosts": "testserver,localhost",
    "api_cors_allowed_origins": "http://localhost:3000",
    "mongodb_uri": SecretStr("mongodb://localhost:27017/frankfurtleague_test"),
    "db_base_name": "frankfurtleague_test",
    "internal_api_key_base": SecretStr(a_key_the_boot_accepts("base")),
    "internal_api_key_system": SecretStr(a_key_the_boot_accepts("system")),
    "internal_api_key_admin": SecretStr(a_key_the_boot_accepts("admin")),
}


def build(**overrides: Any) -> BackendConfig:
    """Every required field passed, as `tests/config.py :: build_test_config` passes them: init arguments outrank every settings source."""
    return BackendConfig(**{**WELL_FORMED, **overrides})


def an_environment(monkeypatch: pytest.MonkeyPatch, working_directory: Path, **overrides: str) -> None:
    """The variables in the process environment and a working directory holding no `.env`.

    `get_config` reads both sources, so a case leaving either standing would be answered by
    whatever the machine running it happens to carry.
    """
    monkeypatch.chdir(working_directory)
    for name, value in {**REQUIRED, **overrides}.items():
        monkeypatch.setenv(name, value)


def boot() -> None:
    """`lifespan` entered as the application enters it: the client is built inside it, so nothing else reaches these refusals."""

    async def enter() -> None:
        async with lifespan(FastAPI()):
            raise AssertionError("the boot is expected to fail before the application starts")

    asyncio.run(enter())


class TestTrustedHosts:
    @pytest.mark.parametrize("value", ["testserver", "*", "*.frankfurtleague.de", "api.frankfurtleague.de, localhost"])
    def test_hostnames_and_the_two_wildcards_are_accepted(self, value):
        assert build(api_trusted_hosts=value).api_trusted_hosts_list == [entry.strip() for entry in value.split(",")]

    @pytest.mark.parametrize("value", ["", "testserver,", "http://testserver", "test server", "frankfurt*league.de"])
    def test_an_entry_the_middleware_could_not_match_fails_the_boot(self, value):
        """The empty entry is the load-bearing one: a trailing comma reads in the middleware as a list that simply trusts less."""
        with pytest.raises(ValidationError):
            build(api_trusted_hosts=value)


class TestCorsAllowedOrigins:
    @pytest.mark.parametrize(
        "value", ["http://localhost:3000", "https://frankfurtleague.de", "https://frankfurtleague.de, https://www.frankfurtleague.de"]
    )
    def test_scheme_host_and_optional_port_are_accepted(self, value):
        assert build(api_cors_allowed_origins=value).api_cors_allowed_origins_list == [entry.strip() for entry in value.split(",")]

    @pytest.mark.parametrize(
        "value", ["", "localhost:3000", "https://frankfurtleague.de/api", "https://frankfurtleague.de/", "ftp://frankfurtleague.de"]
    )
    def test_an_entry_no_origin_header_could_equal_fails_the_boot(self, value):
        """A trailing slash is the case that looks harmless: an `Origin` header carries no path, so the entry matches no browser's request."""
        with pytest.raises(ValidationError):
            build(api_cors_allowed_origins=value)

    def test_the_bare_wildcard_the_hosts_variable_allows_fails_the_boot(self, monkeypatch, tmp_path):
        """Refused on purpose, unlike `API_TRUSTED_HOSTS`: this API is fetched server-side, and a wildcard with credentials is invalid CORS."""
        an_environment(monkeypatch, tmp_path, API_CORS_ALLOWED_ORIGINS="*")

        with pytest.raises(EnvironmentValidationError) as raised:
            get_config()

        assert str(raised.value) == "Invalid environment variables: API_CORS_ALLOWED_ORIGINS"


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


class TestThePoolAndTheTimeout:
    @pytest.mark.parametrize(
        "field,value",
        [
            ("db_server_selection_timeout", 0),
            ("db_server_selection_timeout", -1),
            ("db_server_selection_timeout", 60_001),
            ("db_min_connections", -1),
            ("db_max_connections", 0),
        ],
    )
    def test_a_value_the_driver_or_the_healthcheck_could_not_live_with_fails_the_boot(self, field, value):
        """The ceiling is the case a reader doubts: past it a failed ping outlives the deploy's wait, and nothing reaches its log."""
        with pytest.raises(ValidationError):
            build(**{field: value})

    def test_a_minimum_above_the_maximum_fails_the_boot_naming_both_variables(self, monkeypatch, tmp_path):
        """The pair each bound alone admits: pymongo refuses it while CONSTRUCTING the client, whose refusal blames `MONGODB_URI` instead."""
        an_environment(monkeypatch, tmp_path, DB_MIN_CONNECTIONS="200", DB_MAX_CONNECTIONS="100")

        with pytest.raises(EnvironmentValidationError) as raised:
            get_config()

        # Equality rather than two membership checks: it is also what proves the rejected numbers and
        # the locationless issue's `<unknown>` are both absent.
        assert str(raised.value) == "Invalid environment variables: DB_MAX_CONNECTIONS, DB_MIN_CONNECTIONS"

    def test_a_minimum_equal_to_the_maximum_boots(self, monkeypatch, tmp_path):
        """The boundary the driver allows -- `minPoolSize must be smaller or equal to maxPoolSize` -- so the gate must not refuse it."""
        an_environment(monkeypatch, tmp_path, DB_MIN_CONNECTIONS="100", DB_MAX_CONNECTIONS="100")

        assert get_config().db_min_connections == 100

    def test_the_bounds_leave_the_shipped_defaults_alone(self):
        """Read off the fields rather than an instance: constructing the settings reads the developer's own environment."""
        defaults = BackendConfig.model_fields

        assert defaults["db_server_selection_timeout"].default == 15000
        assert defaults["db_min_connections"].default == 5
        assert defaults["db_max_connections"].default == 100


class TestTheInternalKeys:
    @pytest.mark.parametrize("field", ["internal_api_key_base", "internal_api_key_system", "internal_api_key_admin"])
    @pytest.mark.parametrize("length", [INTERNAL_API_KEY_LENGTH - 1, INTERNAL_API_KEY_LENGTH + 1])
    def test_a_key_of_any_other_length_fails_the_boot(self, field, length):
        """Both bounds: a truncated key answers every internal request 401, and a longer one boots here while the frontend refuses it."""
        with pytest.raises(ValidationError):
            build(**{field: SecretStr("k" * length)})


class TestTheNamesOnlyErrorPath:
    def test_the_refusal_names_the_variables_and_carries_no_rejected_value(self, monkeypatch, tmp_path):
        """The incident's class: a value that reaches the container log is the whole exposure, and a name is all an operator needs."""
        an_environment(monkeypatch, tmp_path, API_CORS_ALLOWED_ORIGINS="frankfurtleague.de", DB_BASE_NAME="frankfurt league")

        with pytest.raises(EnvironmentValidationError) as raised:
            get_config()

        message = str(raised.value)
        assert "API_CORS_ALLOWED_ORIGINS" in message
        assert "DB_BASE_NAME" in message
        assert "frankfurtleague.de" not in message
        assert "frankfurt league" not in message

    def test_the_pydantic_error_is_suppressed_rather_than_chained(self, monkeypatch, tmp_path):
        """`raise ... from None` is what keeps `input_value=` out of the traceback uvicorn prints, and nothing else in the path does."""
        an_environment(monkeypatch, tmp_path, DB_BASE_NAME="frankfurt league")

        with pytest.raises(EnvironmentValidationError) as raised:
            get_config()

        assert raised.value.__cause__ is None
        assert raised.value.__suppress_context__

    def test_a_well_formed_environment_still_builds(self, monkeypatch, tmp_path):
        an_environment(monkeypatch, tmp_path)

        assert get_config().db_base_name == REQUIRED["DB_BASE_NAME"]


class TestTheStartupPing:
    def test_a_server_that_cannot_be_reached_names_the_variable_and_not_the_host(self, monkeypatch, tmp_path, caplog):
        """Driven through the environment: `lifespan` builds its client from `get_config`, the boot's only injection point."""
        an_environment(monkeypatch, tmp_path, MONGODB_URI=UNROUTABLE_URI, DB_SERVER_SELECTION_TIMEOUT="200")

        with caplog.at_level(logging.CRITICAL):
            with pytest.raises(DatabaseUnreachableError) as raised:
                boot()

        assert str(raised.value) == UNREACHABLE.sentence
        assert "192.0.2.1" not in caplog.text
        assert "MONGODB_URI" in caplog.text

    def test_a_uri_the_scheme_check_passes_and_the_driver_cannot_open_names_the_variable(self, monkeypatch, tmp_path, caplog):
        """A truncated value: the driver refuses it while the client is CONSTRUCTED, so a handler around the ping alone never sees it."""
        an_environment(monkeypatch, tmp_path, MONGODB_URI="mongodb://")

        with caplog.at_level(logging.CRITICAL):
            with pytest.raises(DatabaseUnreachableError) as raised:
                boot()

        assert str(raised.value) == NO_SERVER.sentence
        assert "MONGODB_URI" in caplog.text
        # The `extra=` reaching the record is what puts `error_code` in the envelope
        # (`docs/logging/spec.md` §1.2), which is the field an operator greps a boot failure by.
        assert caplog.records[-1].error_code == NO_SERVER.error_code


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

    def test_every_refusal_opens_with_the_variable(self):
        """One opening for the three, so an operator who greps the variable name is handed whichever of them the boot raised."""
        assert all(refusal.sentence.startswith("MONGODB_URI: ") for refusal in (UNREACHABLE, NO_SERVER, REJECTED))

    def test_no_two_refusals_share_a_code(self):
        """A code copied onto a second sentence answers a grep with the other incident, which is worse than no code at all."""
        codes = [refusal.error_code for refusal in (UNREACHABLE, NO_SERVER, REJECTED)]

        assert len(set(codes)) == len(codes)
