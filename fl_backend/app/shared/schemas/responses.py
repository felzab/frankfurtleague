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


class FLRefusedField(BaseModel):
    # The first member of every `loc` FastAPI reports: a set that moves with FastAPI, never with this file.
    in_: Literal["body", "query", "path", "header", "cookie"] = Field(alias="in")
    path: list[str | int]
    # Pydantic's error `type`, never its English `msg`; on a domain rule's
    # refusal, the rule's own code.
    kind: str
    # The error's `ctx` as Pydantic reports it, its JSON scalars alone: the bounds a rule holds the
    # value to, by the names the rule gives them. Empty where the rule names none.
    ctx: dict[str, str | int | float | bool]


# The failure body as published, never as built: `app/core/exception_handlers.py :: error_response`
# writes plain dicts, a model raising inside a handler leaving the caller with no answer at all.
class FLFailureBody(BaseModel):
    """Every refusal's one body, whatever its status, in the shape of RFC 9457's problem details.

    Its members are this API's own extensions alone: a client words a refusal from its code, so no
    `type`, `title` or `detail` carries English a visitor would read.
    """

    error_code: Code
    trace_id: str
    # Each body field the refusal judged, so a form marks it; empty where it judged none.
    fields: list[FLRefusedField]


class FLCreatedResponse(BaseAPIResponse):
    """The id a create minted, which the caller reads the new record by."""

    created_id: CustomObjectId


class FLSweepSaisonsResponse(BaseAPIResponse):
    """The seasons a system pass visits, for its caller to sweep one by one in the order given."""

    saison_ids: list[str]
