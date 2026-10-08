from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any

from fastapi import HTTPException, status

# Named once, because a literal repeated across files is one a rename leaves behind.
DOCUMENT_NOT_FOUND = "DB-COMMON-001"
DUPLICATE_KEY = "DB-COMMON-002"
NO_DATABASE_CLIENT = "DB-CONN-001"
DATABASE_UNREACHABLE = "DB-CONN-002"


@dataclass(frozen=True, kw_only=True)
class WriteRefusal:
    """Why an endpoint refuses: the code, the status its check chose, and the English detail.

    Named fields, not a tuple: the two strings type-check reversed. Keyword-only, so every check spells
    its `status` where `fl_backend/tests/core/test_domain.py` reads it.
    """

    error_code: str
    # Chosen by the check, never looked up from `RULES`, which no write path reads; the test it
    # answers is `docs/backend/spec.md` §1.4's.
    status: HTTPStatus
    message: str
    # The body paths a 422 judged, each as a `REQ-VAL-001` names its own, so a form can mark the field.
    fields: tuple[tuple[str | int, ...], ...] = ()

    def __post_init__(self) -> None:
        # A 422's published body is the one carrying `fields`, so on any other status they would vanish.
        if self.fields and self.status is not HTTPStatus.UNPROCESSABLE_CONTENT:
            raise ValueError(f"{self.error_code} names fields on a {self.status}, whose body carries none")


class BaseAPIException(HTTPException):
    def __init__(
        self,
        status_code: int,
        error_code: str,
        message: str,
        headers: dict[str, str] | None = None,
        *,
        jti: str | None = None,
    ):
        # A real attribute, not only a key inside `detail`: every handler logs `exc.error_code` and
        # the response body carries it, so a code reachable only through the detail dict is one
        # every log line silently replaces with a fallback.
        self.error_code = error_code
        self.error_detail = {"error_code": error_code, "message": message}
        # The actor token a refusal is about, named by its id alone: the token is a credential for the
        # minute it lives, and the id is what a later line about the same token repeats.
        self.jti = jti
        # A refused payload's `fields`, which a 422 alone publishes; `None` keeps them off every other body.
        self.fields: list[dict[str, Any]] | None = None
        super().__init__(status_code=status_code, detail=self.error_detail, headers=headers)


class RequestAuthorizationException(BaseAPIException):
    def __init__(
        self,
        error_code: str,
        message: str = "The provided api-key either does not exist or is not valid",
    ):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            error_code=error_code,
            message=message,
            headers={"WWW-Authenticate": "Bearer"},
        )


class MalformedRequestException(BaseAPIException):
    """A header the request needs is missing or malformed.

    400 and never 401: the caller composed no credential at all, a defect of the caller's, where
    `ActorTokenRefusedException` answers a credential it composed and this side refused.
    """

    def __init__(self, error_code: str, message: str):
        super().__init__(status_code=status.HTTP_400_BAD_REQUEST, error_code=error_code, message=message)


# RFC 9110's 401 must carry a challenge, and `Bearer` would name the tier key, which passed: the
# scheme names the actor token's own header instead.
ACTOR_TOKEN_CHALLENGE = "FL-Actor"


class ActorTokenRefusedException(BaseAPIException):
    """The key passed, and the actor token beside it failed verification: a credential present and not accepted, RFC 9110's 401."""

    def __init__(self, error_code: str, reason: str, *, jti: str | None):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            error_code=error_code,
            # `reason` is `app/core/actor_token.py :: ActorTokenRefusal`'s fixed phrase: the token never reaches the log.
            message=f"the actor token was refused: {reason}",
            headers={"WWW-Authenticate": ACTOR_TOKEN_CHALLENGE},
            jti=jti,
        )


class ActorConfirmationRequiredException(BaseAPIException):
    """The actor may act, from a sign-in older than this write asks: RFC 9470's step-up challenge, a 401 remedied by signing in again."""

    def __init__(self, error_code: str, max_age_s: int, *, jti: str):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            error_code=error_code,
            message=f"the actor's sign-in or confirmation is older than the {max_age_s} seconds this write asks for",
            # RFC 9470 §3's error and parameter, under the actor's own scheme as every refusal of the token names it.
            headers={"WWW-Authenticate": f'{ACTOR_TOKEN_CHALLENGE} error="insufficient_user_authentication", max_age="{max_age_s}"'},
            jti=jti,
        )


class ActorForbiddenException(BaseAPIException):
    """The key passed and the actor it names may not act on its tier.

    403, never 401, whose challenge would name a valid credential. Not a `WriteRefusal`, which is a
    domain rule's and refuses no read.
    """

    def __init__(self, error_code: str, message: str, *, jti: str):
        super().__init__(status_code=status.HTTP_403_FORBIDDEN, error_code=error_code, message=message, jti=jti)


class DatabaseUnavailableException(BaseAPIException):
    def __init__(self, error_code: str, message: str = "The database is not available"):
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            error_code=error_code,
            message=message,
            headers={"Retry-After": "30"},
        )


class DrosselungException(BaseAPIException):
    """A signed-in person's write past the ceiling of the kind of person it was made as, for the German day: RFC 6585's 429.

    `Retry-After` names the seconds to the next German midnight, where the count starts again.
    """

    def __init__(self, error_code: str, retry_after_s: int):
        super().__init__(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            error_code=error_code,
            message="the person's counted writes reached the ceiling of the kind of person they write as, for the German day",
            headers={"Retry-After": str(retry_after_s)},
        )


class DocumentNotFoundException(BaseAPIException):
    def __init__(
        self,
        filter: Mapping[str, Any],
        error_code: str,
        message: str = "No document found with provided filter",
    ):
        self.filter = filter
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            error_code=error_code,
            message=message,
        )


class WriteRefusalException(BaseAPIException):
    """The one route from a refused write or person's read to its response, at the status its check chose."""

    def __init__(self, refusal: WriteRefusal):
        super().__init__(status_code=refusal.status, error_code=refusal.error_code, message=refusal.message)
        if refusal.status is HTTPStatus.UNPROCESSABLE_CONTENT:
            # The rule's own code as the `kind`, where a `REQ-VAL-001` carries pydantic's error type.
            self.fields = [{"in": "body", "path": list(path), "kind": refusal.error_code} for path in refusal.fields]
