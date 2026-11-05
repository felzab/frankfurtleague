from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from http import HTTPStatus
from typing import Any, Literal, LiteralString

from pydantic_core import PydanticCustomError  # noqa: TID251 -- the one place a rule is raised

from app.core.codes import Code, Rule

# The path inside the body a refusal judged, as a `payload_refused` names its own, so a form can mark the field.
FieldPath = tuple[str | int, ...]

# One bound a rule holds a refused value to, by the name the rule gives it: a JSON scalar, or a list of whole numbers
# such as the fixtures a retirement waits on, which is all a failure body's `ctx` carries
# (`app/shared/schemas/responses.py :: FLRefusedField`).
type Bound = str | int | float | bool | list[int]

# Where the field a refusal names arrived: the body, or the path a by-id write names its record in.
type FieldLocation = Literal["body", "path"]


def is_bound(value: Any) -> bool:
    """Whether a context member is a `Bound` a failure body can carry: anything else names nothing a caller could word."""

    if isinstance(value, list):
        return all(isinstance(member, int) and not isinstance(member, bool) for member in value)

    return isinstance(value, str | int | float | bool)


def rule_refusal(rule: Rule, message: LiteralString, bounds: Mapping[str, Bound] | None = None) -> PydanticCustomError:
    """A domain rule's refusal for a validator to raise: its kind one of `Rule`'s, so a kind the contract does not publish fails the type check.

    `message` is the English a log line reads, never a visitor; `bounds` reach the caller as the field's `ctx`.
    """

    return PydanticCustomError(rule, message, None if bounds is None else dict(bounds))


class APIError(Exception):
    """A refusal: its status, the code naming its reason, the body paths it judged and their bounds, which is all a failure body carries.

    `headers` carry what the status asks for beside the body, a 401's challenge or a `Retry-After`. `bounds` are what the
    refused value is held to, by the names the rule gives them, written as each judged field's `ctx` as a
    `PydanticCustomError`'s context is: the caller words the field's line from them, so a bound the server moves moves
    the line with it. A refusal naming no field carries none. `location` says where its fields arrived, the body unless
    a by-id write's refusal names the path's id.
    """

    def __init__(
        self,
        status: HTTPStatus,
        code: Code,
        *,
        headers: Mapping[str, str] | None = None,
        fields: tuple[FieldPath, ...] = (),
        bounds: Mapping[str, Bound] | None = None,
        location: FieldLocation = "body",
    ):
        super().__init__(code)
        self.status_code = int(status)
        self.error_code = code
        self.headers = headers
        self.fields = fields
        self.bounds: Mapping[str, Bound] = dict(bounds or {})
        self.location: FieldLocation = location


class DocumentNotFoundError(APIError):
    """A read or a filtered write that matched nothing: `document_not_found` at 404.

    A type of its own because ten callers take a miss as an answer, and catching it by type keeps
    every other refusal their call raises -- a guard's, a rule's -- out of that `except`.
    """

    def __init__(self) -> None:
        super().__init__(HTTPStatus.NOT_FOUND, Code.DOCUMENT_NOT_FOUND)


@dataclass(frozen=True, kw_only=True)
class WriteRefusal:
    """Why an endpoint refuses: the code, the status its check chose, the body paths it judged, and the bounds its rule holds them to.

    Named fields, not a tuple, so a check spells its `status` beside the code. `bounds` reach the caller as `APIError`'s
    do, on each field in `fields`.
    """

    error_code: Code
    status: HTTPStatus
    fields: tuple[FieldPath, ...] = ()
    bounds: Mapping[str, Bound] = field(default_factory=dict)
    location: FieldLocation = "body"

    def error(self) -> APIError:
        return APIError(self.status, self.error_code, fields=self.fields, bounds=self.bounds, location=self.location)

    @classmethod
    def of(cls, error: APIError) -> WriteRefusal:
        """The refusal `error` raised, for a write answering a step it runs as its own: a refusal carries no headers."""

        return cls(
            error_code=error.error_code,
            status=HTTPStatus(error.status_code),
            fields=error.fields,
            bounds=error.bounds,
            location=error.location,
        )


def as_judged_on_stored_state(refusal: WriteRefusal | None, *, twins: Mapping[Code, Code]) -> WriteRefusal | None:
    """`refusal` as a write judging stored values it carries no body for answers it.

    Under its twin, a 409, where `twins` names one for a code a payload write shares, else its code and status alone:
    never on a field, whose path would name a box of a body the request has not got.
    """

    if refusal is None:
        return None

    if refusal.error_code in twins:
        return WriteRefusal(error_code=twins[refusal.error_code], status=HTTPStatus.CONFLICT)

    return replace(refusal, fields=(), bounds={})


# RFC 9110's 401 must carry a challenge, and `Bearer` would name the tier key, which passed: the
# scheme names the actor's own headers instead.
ACTOR_CHALLENGE = "FL-Actor"
