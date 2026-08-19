from pydantic import SecretStr

from app.core.config import BackendConfig


def build_test_config() -> BackendConfig:
    """Init arguments outrank every pydantic-settings source, so no `.env` is read and a bare checkout runs the suite.

    Not in `conftest.py`: pytest loads that under its own module name, so importing it would
    duplicate every fixture.
    """
    return BackendConfig(
        api_trusted_hosts="testserver,localhost",
        api_cors_allowed_origins="http://localhost:3000",
        mongodb_uri=SecretStr("mongodb://localhost:27017/frankfurtleague_test"),
        db_base_name="frankfurtleague_test",
        # Distinct on purpose: `verify_api_key` compares with `compare_digest`, so equal values would
        # let a test asserting that the admin router rejects the base key pass vacuously.
        internal_api_key_base=SecretStr("test-key-base"),
        internal_api_key_system=SecretStr("test-key-system"),
        internal_api_key_admin=SecretStr("test-key-admin"),
    )
