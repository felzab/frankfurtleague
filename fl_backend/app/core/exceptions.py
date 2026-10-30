from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from http import HTTPStatus

from app.core.codes import Code

# The path inside the body a 422 judged, as a `payload_refused` names its own, so a form can mark the field.
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


class DocumentNotFoundError(APIError):
    """A read or a filtered write that matched nothing: `document_not_found` at 404.

    A type of its own because ten callers take a miss as an answer, and catching it by type keeps
    every other refusal their call raises -- a guard's, a rule's -- out of that `except`.
    """

    def __init__(self) -> None:
        super().__init__(HTTPStatus.NOT_FOUND, Code.DOCUMENT_NOT_FOUND)


@dataclass(frozen=True, kw_only=True)
class WriteRefusal:
    """Why an endpoint refuses: the code, the status its check chose, and the body paths a 422 judged.

    Named fields, not a tuple, so a check spells its `status` beside the code.
    """

    error_code: Code
    status: HTTPStatus
    fields: tuple[FieldPath, ...] = ()

    def error(self) -> APIError:
        return APIError(self.status, self.error_code, fields=self.fields)


# RFC 9110's 401 must carry a challenge, and `Bearer` would name the tier key, which passed: the
# scheme names the actor's own headers instead.
ACTOR_CHALLENGE = "FL-Actor"
