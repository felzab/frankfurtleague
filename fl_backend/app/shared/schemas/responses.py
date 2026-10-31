from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.codes import Code
from app.shared.schemas.custom import CustomObjectId


class BaseReadModel(BaseModel):
    """Every served model's base, so a field the answer always carries is published as required.

    Pydantic publishes a field with a default as optional unless this is set, and sets it per model,
    so a nested model needs it as much as the body it sits in. A model a payload also declares stays
    off it: its input and output schemas would part into two components.
    """

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class BaseAPIResponse(BaseReadModel):
    """Every response body's base."""


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


class FLSweepSaisonsResponse(BaseAPIResponse):
    """The seasons a system pass visits, for its caller to sweep one by one in the order given."""

    saison_ids: list[str]
