from __future__ import annotations

from collections.abc import Mapping
from http import HTTPStatus
from typing import Any, Literal, LiteralString

from pydantic_core import PydanticCustomError  # noqa: TID251 -- the one place a rule is raised

from app.core.codes import Code, Rule

# The path inside the body a refusal judged, as a `payload_refused` names its own, so a form can mark the field.
FieldPath = tuple[str | int, ...]

# One bound a rule holds a refused value to, by the name the rule gives it: a JSON scalar, or a list of whole numbers
# such as the fixtures a retirement waits on, which is all a failure body's `ctx` carries.
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

    `headers` carry what the status asks for beside the body, a 401's challenge. `bounds` are what the
    refused value is held to, by the names the rule gives them, written as each judged field's `ctx` as a
    `PydanticCustomError`'s context is: the caller words the field's line from them, so a bound the server moves moves
    the line with it. A refusal naming no field carries none. `location` says where its fields arrived, the body unless
    a by-id write's refusal names the path's id.

    A check returns one unraised, or `None`, so its caller orders several through `refuse` and a page can be served the
    code a press would meet before anyone presses.
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

    A type of its own because callers take a miss as an answer, and catching it by type keeps
    every other refusal their call raises -- a guard's, a rule's -- out of that `except`.
    """

    def __init__(self) -> None:
        super().__init__(HTTPStatus.NOT_FOUND, Code.DOCUMENT_NOT_FOUND)


# A mailed link's two refusals, each slice judging its own link and raising these. Factories rather than module-level
# instances: a raised exception keeps its traceback and context, so one shared instance would carry every earlier raise's
# frames into the next, and one request's context into another's.


def link_invalid() -> APIError:
    """`link_invalid` at 404: the link opens no record.

    One answer for a token never minted, one a later mint replaced and one whose record is gone: nothing tells them from
    a stranger's guess, and naming which would tell the guess more than it knew.
    """

    return APIError(HTTPStatus.NOT_FOUND, Code.LINK_INVALID)


def link_expired() -> APIError:
    """`link_expired` at 410: the link opens its record, which takes no answer through it any more; no write reopens it."""

    return APIError(HTTPStatus.GONE, Code.LINK_EXPIRED)


# A write's twin of each code it shares with a payload write: by the code alone, or, where one code covers several
# fields, by the first name of the path it judged, as the catalogue keys a sentence by that name, since the twin names
# no path for the catalogue to read.
type Twins = Mapping[Code, Code | Mapping[str, Code]]


def as_judged_on_stored_state(refusal: APIError | None, *, twins: Twins) -> APIError | None:
    """`refusal` as a write judging stored values it carries no body for answers it.

    Under its twin, a 409, where `twins` names one for a code a payload write shares, else its code and status alone:
    never on a field, whose path would name a box of a body the request has not got.
    """

    if refusal is None:
        return None

    twin = twins.get(refusal.error_code)
    if isinstance(twin, Mapping):
        head = refusal.fields[0][0] if refusal.fields else None
        twin = twin.get(head) if isinstance(head, str) else None
    if twin is not None:
        return APIError(HTTPStatus.CONFLICT, twin)

    return APIError(HTTPStatus(refusal.status_code), refusal.error_code)


# RFC 9110's 401 must carry a challenge, and `Bearer` would name the tier key, which passed: the
# scheme names the actor's own headers instead.
ACTOR_CHALLENGE = "FL-Actor"
