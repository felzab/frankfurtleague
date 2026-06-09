from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class BackendConfig(BaseSettings):
    # API config
    api_version: int = Field(description="The currently used version of this API")
    api_trusted_hosts: str = Field(description="The trusted hosts for this API")
    api_cors_allowed_origins: str = Field(description="The allowed CORS origins for this API")

    @property
    def api_trusted_hosts_list(self) -> list[str]:
        return [h.strip() for h in self.api_trusted_hosts.split(",")]

    @property
    def api_cors_allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.api_cors_allowed_origins.split(",")]

    # MongoDB Configuration
    mongodb_uri: SecretStr = Field(description="MongoDB Connection URI")
    db_base_name: str = Field(description="Base DB name")
    db_server_selection_timeout: int = Field(default=15000, description="MongoDB server-selection timeout in ms")
    db_min_connections: int = Field(default=5, description="Min pool size")
    db_max_connections: int = Field(default=100, description="Max pool size")

    # Security Configuration
    internal_api_key_base: SecretStr = Field(description="Base internal API-key")
    internal_api_key_system: SecretStr = Field(description="Internal API-key for the system router")
    internal_api_key_admin: SecretStr = Field(description="Internal API-key for the admin router")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("mongodb_uri")
    def validate_mongodb_uri(cls, value: SecretStr) -> SecretStr:
        uri = value.get_secret_value()
        if not (uri.startswith("mongodb://") or uri.startswith("mongodb+srv://")):
            raise ValueError("MongoDB URI must start with 'mongodb://' or 'mongodb+srv://'")
        return value


backend_config = BackendConfig()  # type: ignore[call-arg]
