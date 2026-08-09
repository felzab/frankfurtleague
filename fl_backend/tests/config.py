"""
TESTS · the settings an application under test is built with

A module rather than a fixture, because two callers need it at different times: `conftest.py`
exposes it as a fixture, and `api/test_admin_guard.py` needs an app at module level — pytest
resolves parametrisation during collection, before any fixture runs. Not in `conftest.py`
itself: under `--import-mode=importlib` pytest loads that file under its own module name, so
importing it again would produce a second copy of every fixture.
"""

from pydantic import SecretStr

from app.core.config import BackendConfig


def build_test_config() -> BackendConfig:
    """
    The suite's settings, constructed EXPLICITLY.

    Init arguments outrank every other source in pydantic-settings, so this reads neither the
    environment nor `fl_backend/.env` — a developer's real production credentials are never loaded by
    the suite, and a checkout with no `.env` at all runs it unchanged. A failure therefore means the
    code, never the machine.

    Nothing here is dialled: the tests that want a real server get one from testcontainers (ADR-0030).
    The three API keys are DISTINCT on purpose — `verify_api_key` compares with `compare_digest`, so
    identical values would let a test asserting that the admin router rejects the base key pass
    vacuously.
    """
    return BackendConfig(
        api_trusted_hosts="testserver,localhost",
        api_cors_allowed_origins="http://localhost:3000",
        mongodb_uri=SecretStr("mongodb://localhost:27017/frankfurtleague_test"),
        db_base_name="frankfurtleague_test",
        internal_api_key_base=SecretStr("test-key-base"),
        internal_api_key_system=SecretStr("test-key-system"),
        internal_api_key_admin=SecretStr("test-key-admin"),
    )
