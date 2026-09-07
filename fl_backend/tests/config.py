from pydantic import SecretStr
from pydantic_settings import SettingsConfigDict

from app.core.config import INTERNAL_API_KEY_LENGTH, BackendConfig
from tests.worker import worker_database

# The base name of the corpus the pymongo-seeded suites share. What they seed and what the app under
# test reads are both `db_base_name` below, so the scoping applied once here reaches both.
CORPUS_DATABASE = "frankfurtleague_test"

# The host `build_test_config` trusts below, spelled as a URL because that is what an in-process
# request needs: `TrustedHostMiddleware` refuses any other `Host` before a route sees it.
TEST_BASE_URL = "http://testserver"

# Distinct on purpose: `verify_api_key` compares with `compare_digest`, so equal values would let a
# test asserting that the admin router rejects the base key pass vacuously. Padded because the boot
# pins the length, which no test here reads.
_KEY_BASE = "test-key-base".ljust(INTERNAL_API_KEY_LENGTH, "0")
_KEY_SYSTEM = "test-key-system".ljust(INTERNAL_API_KEY_LENGTH, "0")
_KEY_ADMIN = "test-key-admin".ljust(INTERNAL_API_KEY_LENGTH, "0")

# The header a request carries to reach each tier, built from the keys `build_test_config` configures
# so that no suite spells one of its own: `compare_digest` answers a drifted key 401 and names no side.
BASE_AUTH = {"Authorization": f"Bearer {_KEY_BASE}"}
SYSTEM_AUTH = {"Authorization": f"Bearer {_KEY_SYSTEM}"}
ADMIN_AUTH = {"Authorization": f"Bearer {_KEY_ADMIN}"}


class ConfigReadingNoDotenvFile(BackendConfig):
    """The suite's settings, reading no dotenv file: a machine's own `.env` is not a fixture.

    An init argument outranks a source's value and never its extra keys, which `extra="forbid"`
    makes fatal.
    """

    # Merged over the parent's rather than replacing it, so `extra="forbid"` and the encoding still
    # bind: only the dotenv source is dropped.
    model_config = SettingsConfigDict(env_file=None)


def build_test_config() -> BackendConfig:
    """Every variable with no default supplied here, so any checkout runs the suite.

    Not in `conftest.py`: pytest loads that under its own module name, so importing it would
    duplicate every fixture. No dotenv source, for the reason at `ConfigReadingNoDotenvFile`.
    """
    return ConfigReadingNoDotenvFile(
        api_trusted_hosts="testserver,localhost",
        api_cors_allowed_origins="http://localhost:3000",
        mongodb_uri=SecretStr("mongodb://localhost:27017/frankfurtleague_test"),
        db_base_name=worker_database(CORPUS_DATABASE),
        internal_api_key_base=SecretStr(_KEY_BASE),
        internal_api_key_system=SecretStr(_KEY_SYSTEM),
        internal_api_key_admin=SecretStr(_KEY_ADMIN),
    )
