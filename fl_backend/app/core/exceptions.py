from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from http import HTTPStatus
from typing import LiteralString

from pydantic_core import PydanticCustomError

from app.core.codes import Code, Rule

# The path inside the body a refusal judged, as a `payload_refused` names its own, so a form can mark the field.
FieldPath = tuple[str | int, ...]

# One bound a rule holds a refused value to, by the name the rule gives it: a JSON scalar, which is all a failure
# body's `ctx` carries (`app/shared/schemas/responses.py :: FLRefusedField`).
type Bound = str | int | float | bool


def rule_refusal(rule: Rule, message: LiteralString, bounds: Mapping[str, Bound] | None = None) -> PydanticCustomError:
    """A domain rule's refusal for a validator to raise: its kind one of `Rule`'s, so a kind the contract does not publish fails the type check.

    `message` is the English a log line reads, never a visitor; `bounds` reach the caller as the field's `ctx`.
    """

    return PydanticCustomError(rule, message, None if bounds is None else dict(bounds))


class APIError(Exception):
    """A refusal: the status it answers, the code naming its reason and the body paths it judged, which is all a failure body carries.

    `headers` carry what the status asks for beside the body, a 401's challenge or a `Retry-After`.
    """

    def __init__(self, status: HTTPStatus, code: Code, *, headers: Mapping[str, str] | None = None, fields: tuple[FieldPath, ...] = ()):
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
    """Why an endpoint refuses: the code, the status its check chose, and the body paths it judged.

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
