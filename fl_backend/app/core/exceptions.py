"""
CORE · application exceptions

Every failure carries an `error_code` alongside its message, so a log line names a specific
failure rather than a status class. The codes are part of the API contract.

Invariants:
- A new failure mode gets a new error code, never a reused one.
- The `Retry-After` and `WWW-Authenticate` headers on the two carrier exceptions are contract.
- Every write-path refusal is a `WriteRefusal`, and reaches the client through `from_refusal`.

See:
- docs/logging/error-codes.md — the error-code table and the failure-body contract
"""

from dataclasses import dataclass
from typing import Any, Mapping, Optional

from fastapi import HTTPException, status

# The codes raised from more than one place. Named once because a literal repeated across files is a
# literal a rename leaves behind at all but the one somebody remembered.
DOCUMENT_NOT_FOUND = "DB-COMMON-001"
NO_DATABASE_CLIENT = "DB-CONN-001"


@dataclass(frozen=True)
class WriteRefusal:
    """
    Why a write path refuses, as the one shape every `find_*_refusal` returns: the code, and the English detail.

    The code is the whole channel. A failure body is `{error_code, correlation_id}` and nothing else
    (`app/core/exception_handlers.py :: error_response`), so the message below is for the log and the code is
    what the form reads to decide which field the refusal belongs to.

    A named pair rather than a `(str, str)` tuple, because both members are strings: a tuple built the other
    way round type-checks, lints and passes any test asserting only that a refusal was produced, and ships
    the English detail in the one field the client acts on.
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
        # A real attribute, not only a key inside `detail`: the exception handler logs
        # `exc.error_code` and the response body carries it, so a code reachable only through the
        # detail dict is a code every log line silently replaces with a fallback.
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
    """
    The write is well-formed and the current state refuses it — raise this rather than letting it 500.

    409 rather than 422, because nothing about the payload is wrong: the same request would have
    succeeded a moment earlier, or will succeed once something else changes. A delete whose target is
    still referenced is the shape that belongs here.

    A unique index refusing a write does NOT come through here. `pymongo` raises `DuplicateKeyError`
    before any handler code runs, and `duplicate_key_exception_handler` maps every one of those to a
    409 under the fixed code `DB-COMMON-002`, where this class carries the rule's own code.

    Kept distinct from `DocumentNotFoundException` deliberately. Both are "the database said no", and a
    caller retrying a 404 is confused while a caller retrying a 409 is wrong.
    """

    def __init__(self, error_code: str, message: str = "The request conflicts with the current state of the resource"):
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            error_code=error_code,
            message=message,
        )

    @classmethod
    def from_refusal(cls, refusal: WriteRefusal) -> "DocumentConflictException":
        """
        The one route from a refused write to its response, so no endpoint spells a code of its own.

        A rule owns its code beside the check that raises it; an endpoint that names one instead holds a copy
        that a rename cannot reach and that no test compares against the original.
        """

        return cls(error_code=refusal.error_code, message=refusal.message)
