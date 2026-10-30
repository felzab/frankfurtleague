from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.codes import Code
from app.shared.schemas.custom import CustomObjectId


class BaseAPIResponse(BaseModel):
    """Every response model's base, so a field the answer always carries is published as required.

    Pydantic publishes a field with a default as optional unless this is set, and a client generated
    from the document would then guard against an absence the answer never has.
    """

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


# The failure bodies as published, never as built: `app/core/exception_handlers.py :: error_response`
# writes plain dicts, a model raising inside a handler leaving the caller with no answer at all.
class FLFailureBody(BaseModel):
    error_code: Code
    trace_id: str


class FLRefusedField(BaseModel):
    # The first member of every `loc` FastAPI reports: a set that moves with FastAPI, never with this file.
    in_: Literal["body", "query", "path", "header", "cookie"] = Field(alias="in")
    path: list[str | int]
    # Pydantic's error `type`, never its English `msg`; on a domain rule's
    # 422, the rule's own code.
    kind: str


class FLRefusedPayloadBody(FLFailureBody):
    fields: list[FLRefusedField]


class FLCreatedResponse(BaseAPIResponse):
    """The id a create minted, which the caller reads the new record by."""

    created_id: CustomObjectId
