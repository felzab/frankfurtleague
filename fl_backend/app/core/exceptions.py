from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any

from app.core.codes import Code  # Session 2: the sweep moves every use onto Code and deletes these aliases.

# Named once, because a literal repeated across files is one a rename leaves behind.
DOCUMENT_NOT_FOUND = Code.DOCUMENT_NOT_FOUND
DUPLICATE_KEY = Code.DUPLICATE_KEY
NO_DATABASE_CLIENT = Code.NO_DATABASE_CLIENT

# The path inside the body a 422 judged, as a `REQ-VAL-001` names its own, so a form can mark the field.
FieldPath = tuple[str | int, ...]


class APIError(Exception):
    """A refusal: the status it answers and the code naming its reason, which is all a failure body carries.

    `headers` carry what the status asks for beside the body, a 401's challenge or a `Retry-After`.
    """

    def __init__(self, status: HTTPStatus, code: Code, *, headers: Mapping[str, str] | None = None, fields: tuple[FieldPath, ...] = ()):
        # A 422's body is the one carrying `fields`, so on any other status they would vanish.
        if fields and status is not HTTPStatus.UNPROCESSABLE_CONTENT:
            raise ValueError(f"{code} names fields on a {status}, whose body carries none")

        super().__init__(code)
        self.status_code = int(status)
        self.error_code = code
        self.headers = headers
        self.fields = fields


@dataclass(frozen=True, kw_only=True)
class WriteRefusal:
    """Why an endpoint refuses: the code, the status its check chose, and the body paths a 422 judged.

    Named fields, not a tuple, so a check spells its `status` beside the code.
    """

    error_code: Code
    status: HTTPStatus
    # Session 2: the sweep moves every raise onto APIError and deletes this.
    message: str
    fields: tuple[FieldPath, ...] = ()


# Session 2: the sweep moves every raise onto APIError and deletes this.
BaseAPIException = APIError


# Session 2: the sweep moves every raise onto APIError and deletes this.
class _LegacyAPIError(APIError):
    def __init__(
        self,
        status: HTTPStatus,
        code: Code,
        message: str,
        *,
        headers: Mapping[str, str] | None = None,
        fields: tuple[FieldPath, ...] = (),
        jti: str | None = None,
    ):
        super().__init__(status, code, headers=headers, fields=fields)
        # Session 2: the sweep moves every raise onto APIError and deletes this.
        self.error_detail = {"error_code": code, "message": message}
        # Session 2: the sweep moves every raise onto APIError and deletes this.
        self.detail = self.error_detail
        # Session 2: the sweep moves every raise onto APIError and deletes this.
        self.jti = jti


# RFC 9110's 401 must carry a challenge, and `Bearer` would name the tier key, which passed: the
# scheme names the actor token's own header instead.
ACTOR_TOKEN_CHALLENGE = "FL-Actor"


# Session 2: the sweep moves every raise onto APIError and deletes this.
class MalformedRequestException(_LegacyAPIError):
    def __init__(self, error_code: Code, message: str):
        super().__init__(HTTPStatus.BAD_REQUEST, error_code, message)


# Session 2: the sweep moves every raise onto APIError and deletes this.
class ActorTokenRefusedException(_LegacyAPIError):
    def __init__(self, error_code: Code, reason: str, *, jti: str | None):
        super().__init__(
            HTTPStatus.UNAUTHORIZED,
            error_code,
            f"the actor token was refused: {reason}",
            headers={"WWW-Authenticate": ACTOR_TOKEN_CHALLENGE},
            jti=jti,
        )


# Session 2: the sweep moves every raise onto APIError and deletes this.
class ActorConfirmationRequiredException(_LegacyAPIError):
    def __init__(self, error_code: Code, max_age_s: int, *, jti: str):
        super().__init__(
            HTTPStatus.UNAUTHORIZED,
            error_code,
            f"the actor's sign-in or confirmation is older than the {max_age_s} seconds this write asks for",
            # RFC 9470 §3's error and parameter, under the actor's own scheme as every refusal of the token names it.
            headers={"WWW-Authenticate": f'{ACTOR_TOKEN_CHALLENGE} error="insufficient_user_authentication", max_age="{max_age_s}"'},
            jti=jti,
        )


# Session 2: the sweep moves every raise onto APIError and deletes this.
class ActorForbiddenException(_LegacyAPIError):
    def __init__(self, error_code: Code, message: str, *, jti: str):
        super().__init__(HTTPStatus.FORBIDDEN, error_code, message, jti=jti)


# Session 2: the sweep moves every raise onto APIError and deletes this.
class DatabaseUnavailableException(_LegacyAPIError):
    def __init__(self, error_code: Code, message: str = "The database is not available"):
        super().__init__(HTTPStatus.SERVICE_UNAVAILABLE, error_code, message, headers={"Retry-After": "30"})


# Session 2: the sweep moves every raise onto APIError and deletes this.
class DrosselungException(_LegacyAPIError):
    """`Retry-After` names the seconds to the next German midnight, where the count starts again."""

    def __init__(self, error_code: Code, retry_after_s: int):
        super().__init__(
            HTTPStatus.TOO_MANY_REQUESTS,
            error_code,
            "the person's counted writes reached the ceiling of the kind of person they write as, for the German day",
            headers={"Retry-After": str(retry_after_s)},
        )


# Session 2: the sweep moves every raise onto APIError and deletes this.
class DocumentNotFoundException(_LegacyAPIError):
    def __init__(self, filter: Mapping[str, Any], error_code: Code, message: str = "No document found with provided filter"):
        super().__init__(HTTPStatus.NOT_FOUND, error_code, message)
        # Session 2: the sweep moves every raise onto APIError and deletes this.
        self.filter = filter


# Session 2: the sweep moves every raise onto APIError and deletes this.
class WriteRefusalException(_LegacyAPIError):
    def __init__(self, refusal: WriteRefusal):
        super().__init__(refusal.status, refusal.error_code, refusal.message, fields=refusal.fields)
