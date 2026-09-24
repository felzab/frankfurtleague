from typing import Literal

from pydantic import BaseModel, Field


class BaseAPIResponse(BaseModel):
    # On every response model, so a client tells a successful empty result from a failure without
    # reading the status code.
    acknowledged: Literal[0, 1] = 1


# The failure bodies as published, never as built: `app/core/exception_handlers.py :: error_response`
# writes plain dicts, a model raising inside a handler leaving the caller with no answer at all.
class FLFailureBody(BaseModel):
    error_code: str
    trace_id: str


class FLRefusedField(BaseModel):
    # The first member of every `loc` FastAPI reports: a set that moves with FastAPI, never with this file.
    in_: Literal["body", "query", "path", "header", "cookie"] = Field(alias="in")
    path: list[str | int]
    # Pydantic's error `type`, never its English `msg` (`docs/logging/spec.md :: L4`).
    kind: str


class FLRefusedPayloadBody(FLFailureBody):
    fields: list[FLRefusedField]
