from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Any, Literal, LiteralString

from pydantic_core import PydanticCustomError  # noqa: TID251 -- the one place a rule is raised

from app.core.codes import Code, FieldCode, Rule

# The path inside the body a refusal judged, as a `payload_refused` names its own, so a form can mark the field.
FieldPath = tuple[str | int, ...]

# One bound a rule holds a refused value to, by the name the rule gives it: a JSON scalar, or a list of whole numbers
# such as the fixtures a retirement waits on, which is all a failure body's `ctx` carries.
type Bound = str | int | float | bool | list[int]

# Where the field a refusal names arrived: the body, or the path a by-id write names its record in.
type FieldLocation = Literal["body", "path"]

# What a fault judged: who asks against the typed value (403), the value against what is stored (409), or the payload
# against itself (422).
type FaultStatus = Literal[HTTPStatus.FORBIDDEN, HTTPStatus.CONFLICT, HTTPStatus.UNPROCESSABLE_CONTENT]


@dataclass(frozen=True, slots=True, kw_only=True)
class FieldFault:
    """One box a judge refused: its path in the body, the code naming why, the bounds it is held to, and what it judged.

    Not an exception, so nothing raises one alone: a judge hands every fault its independent checks found to
    `app.core.crud.refuse_faults`, which raises them as one refusal naming each. `bounds` reach the caller as the
    field's `ctx`, so a bound the server moves moves the box's phrase with it.
    """

    path: FieldPath
    code: FieldCode
    status: FaultStatus
    bounds: Mapping[str, Bound] = field(default_factory=dict[str, Bound])


# What a field check answers: the fault it found, one per box where its rule names several, or `None`.
type FieldCheck = FieldFault | Sequence[FieldFault] | None


def faults_of(checks: Iterable[FieldCheck]) -> tuple[FieldFault, ...]:
    """Every fault these checks found, in the order they were asked."""

    return tuple(fault for check in checks if check is not None for fault in ((check,) if isinstance(check, FieldFault) else check))


def refusal_status(faults: Sequence[FieldFault]) -> HTTPStatus:
    """The status of one answer naming these faults, never the first fault's alone, so the order checks are written in moves none.

    403 where any fault judged who asks, which no edit of the payload lifts; else 409 where any judged stored data, which
    an edit of the payload alone may not lift; else 422, the payload contradicting itself.
    """

    statuses = {fault.status for fault in faults}
    for status in (HTTPStatus.FORBIDDEN, HTTPStatus.CONFLICT):
        if status in statuses:
            return status

    return HTTPStatus.UNPROCESSABLE_CONTENT


@dataclass(frozen=True, slots=True, kw_only=True)
class Subject:
    """The one field a gate's refusal stands at, beside its code: the record a by-id write names, or a stored body's field.

    Never a box's fault: a gate stops the write before any box means anything, so its caller picks the gate's sentence
    by the path and the bounds, and marks no box.
    """

    path: FieldPath
    location: FieldLocation
    bounds: Mapping[str, Bound] = field(default_factory=dict[str, Bound])


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
    """A gate's refusal: its status, the code naming its reason and at most the one field it stands at, all a failure body carries.

    A gate stops the write before any box means anything: not found, not allowed, a stale version, a closed season, a
    record a by-id write may not take. `headers` carry what the status asks for beside the body, a 401's challenge.
    `subject` is the field the gate's sentence reads, written as one `fields` entry under the gate's own code.

    A gate check returns one unraised, or `None`, so its caller orders several through `app.core.crud.refuse` and a page
    can be served the code a press would meet before anyone presses. A box's faults never ride on a gate: they are
    `FieldFault`s, which `faults` lists on the one refusal `refuse_faults` raises, and which a gate holds none of.
    """

    def __init__(
        self,
        status: HTTPStatus,
        code: Code,
        *,
        headers: Mapping[str, str] | None = None,
        subject: Subject | None = None,
    ):
        super().__init__(code)
        self.status_code = int(status)
        self.error_code = code
        self.headers = headers
        self.subject = subject
        self.faults: tuple[FieldFault, ...] = ()


class FieldRefusal(APIError):
    """Every fault one collecting call found, as one refusal: each its own `fields` entry, with its own code and bounds.

    Its code is the first fault's and its status `refusal_status`'s. Constructed by `app.core.crud.refuse_faults` alone,
    which ruff's banned-api holds, so no gate carries a box's fault and no fault reaches the body any other way.
    """

    def __init__(self, faults: tuple[FieldFault, ...]):
        first, *_ = faults
        super().__init__(refusal_status(faults), first.code)
        self.faults = faults


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


def as_judged_on_stored_state(check: FieldCheck) -> APIError | None:
    """`check`'s faults as a write judging stored values it carries no body for answers them: one gate, its code the first's.

    Never on a field, whose path would name a box of a body the request has not got.
    """

    faults = faults_of((check,))
    if not faults:
        return None

    return APIError(refusal_status(faults), faults[0].code)


# RFC 9110's 401 must carry a challenge, and `Bearer` would name the tier key, which passed: the
# scheme names the actor's own headers instead.
ACTOR_CHALLENGE = "FL-Actor"
