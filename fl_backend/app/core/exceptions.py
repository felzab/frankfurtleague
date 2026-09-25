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
    """Why a write path refuses: the code, the status its check chose, and the English detail.

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
    ):
        # A real attribute, not only a key inside `detail`: every handler logs `exc.error_code` and
        # the response body carries it, so a code reachable only through the detail dict is one
        # every log line silently replaces with a fallback.
        self.error_code = error_code
        self.error_detail = {"error_code": error_code, "message": message}
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


class WriteRefusalException(BaseAPIException):
    """The one route from a refused write to its response, at the status its check chose."""

    def __init__(self, refusal: WriteRefusal):
        super().__init__(status_code=refusal.status, error_code=refusal.error_code, message=refusal.message)
        if refusal.status is HTTPStatus.UNPROCESSABLE_CONTENT:
            # The rule's own code as the `kind`, where a `REQ-VAL-001` carries pydantic's error type.
            self.fields = [{"in": "body", "path": list(path), "kind": refusal.error_code} for path in refusal.fields]
