import secrets
from typing import Callable

from fastapi import Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import backend_config
from app.core.exceptions import RequestAuthorizationException

# Tell FastAPI to look for the "Authorization" header
bearer_scheme = HTTPBearer(auto_error=False)


def get_token(credentials: HTTPAuthorizationCredentials = Security(bearer_scheme)) -> str:
    if credentials is None:
        raise RequestAuthorizationException(error_code="REQ-AUTH-001")

    return credentials.credentials


# Factory function to create security dependencies
def verify_api_key(expected_key: str, error_code: str) -> Callable:
    def dependency(token: str = Security(get_token)):

        if not secrets.compare_digest(token, expected_key):
            raise RequestAuthorizationException(error_code=error_code)
        return token

    return dependency


# Dependencies used in Routers
verify_access_base = verify_api_key(
    expected_key=backend_config.internal_api_key_base.get_secret_value(), error_code="REQ-AUTH-002"
)
verify_access_system = verify_api_key(
    expected_key=backend_config.internal_api_key_system.get_secret_value(), error_code="REQ-AUTH-003"
)
verify_access_admin = verify_api_key(
    expected_key=backend_config.internal_api_key_admin.get_secret_value(), error_code="REQ-AUTH-004"
)
