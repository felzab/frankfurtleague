from dataclasses import dataclass
from typing import Any, Mapping, Optional

from fastapi import HTTPException, status

# Named once, because a literal repeated across files is one a rename leaves behind.
DOCUMENT_NOT_FOUND = "DB-COMMON-001"
NO_DATABASE_CLIENT = "DB-CONN-001"


@dataclass(frozen=True)
class WriteRefusal:
    """Why a write path refuses: the code, and the English detail.

    A named pair, not a `(str, str)` tuple: both are strings, so a reversed one type-checks.
    """

    error_code: str
    message: str


class BaseAPIException(HTTPException):
    def __init__(
        self,
        status_code: int,
        error_code: str,
        message: str,
        headers: Optional[dict[str, str]] = None,
    ):
        # A real attribute, not only a key inside `detail`: every handler logs `exc.error_code` and
        # the response body carries it, so a code reachable only through the detail dict is one
        # every log line silently replaces with a fallback.
        self.error_code = error_code
        self.error_detail = {"error_code": error_code, "message": message}
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


class DatabaseUnavailableException(BaseAPIException):
    def __init__(self, error_code: str, message: str = "The database is not available"):
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            error_code=error_code,
            message=message,
            headers={"Retry-After": "30"},
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


class DocumentConflictException(BaseAPIException):
    """The write is well-formed and the current state refuses it.

    409, not 422: nothing about the payload is wrong, and the same request would have succeeded a
    moment earlier.
    """

    def __init__(self, error_code: str, message: str = "The request conflicts with the current state of the resource"):
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            error_code=error_code,
            message=message,
        )

    @classmethod
    def from_refusal(cls, refusal: WriteRefusal) -> "DocumentConflictException":
        """The one route from a refused write to its response: a rule owns its code beside the check that raises it."""

        return cls(error_code=refusal.error_code, message=refusal.message)
