"""
CORE · application exceptions

Every failure carries an `error_code` alongside its message, so a log line names a specific failure
rather than a status class. The codes are listed in the backend spec and are part of the API contract.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • A new failure mode gets a new error code, never a reused one -- the codes are what make logs
    greppable.
  • `DatabaseUnavailableException` carries `Retry-After`; `RequestAuthorizationException` carries
    `WWW-Authenticate`. Both headers are part of the response contract, not decoration.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/backend/spec.md -- the error-code table
"""

from typing import Any, Mapping, Optional

from fastapi import HTTPException, status


class BaseAPIException(HTTPException):
    def __init__(
        self,
        status_code: int,
        error_code: str,
        message: str,
        headers: Optional[dict[str, str]] = None,
    ):
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
    """
    The write is well-formed and the current state refuses it.

    409 rather than 422, because nothing about the payload is wrong -- the same request would have
    succeeded a moment earlier, or will succeed once something else changes. The two things that raise
    it: a unique index the write would violate (a second team taking a shorthand, a second squad row for
    a player in one season), and a delete whose target is still referenced.

    Kept distinct from `DocumentNotFoundException` deliberately. Both are "the database said no", and a
    caller retrying a 404 is confused while a caller retrying a 409 is wrong.
    """

    def __init__(self, error_code: str, message: str = "The request conflicts with the current state of the resource"):
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            error_code=error_code,
            message=message,
        )
