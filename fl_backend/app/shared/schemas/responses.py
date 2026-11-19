from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.codes import Code
from app.core.exceptions import Bound
from app.shared.schemas.custom import CustomObjectId, CustomVersion


class BaseReadModel(BaseModel):
    """Every served model's base, so a field the answer always carries is published as required.

    Pydantic publishes a field with a default as optional unless this is set, and sets it per model,
    so a nested model needs it as much as the body it sits in. A model a payload also declares stays
    off it: its input and output schemas would part into two components.
    """

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class BasePayload(BaseModel):
    """Every request body's base, and the base of each model one nests: a key the model does not declare is refused.

    Beside the read base, never above it: a read model refusing an unknown key would refuse a stored document the
    collection has grown. A payload deriving from a read shape names this base last, since Pydantic merges a model's
    bases' configurations in order and the later wins.
    """

    model_config = ConfigDict(extra="forbid")


class FLRefusedField(BaseModel):
    # The first member of every `loc` FastAPI reports: a set that moves with FastAPI, never with this file.
    in_: Literal["body", "query", "path", "header", "cookie"] = Field(alias="in")
    path: list[str | int]
    # Pydantic's error `type`, never its English `msg`: one of Pydantic's own, a domain rule's `Rule`, or on an
    # endpoint's refusal its `Code`.
    kind: str
    # The bounds the rule holds the refused value to, JSON scalars or a list of whole numbers, by the names the rule
    # gives them, one of which can be another field of the same payload: a domain rule's context, or an endpoint
    # refusal's bounds. Empty for Pydantic's own kinds and where the rule names none.
    ctx: dict[str, Bound]


# The failure body as published, never as built: the handler writes plain dicts, since a model raising inside a
# handler leaves the caller with no answer at all.
class FLFailureBody(BaseModel):
    """Every refusal's one body, whatever its status, in the shape of RFC 9457's problem details.

    Its members are this API's own extensions alone: a client words a refusal from its code, so no
    `type`, `title` or `detail` carries English a visitor would read.
    """

    error_code: Code
    trace_id: str
    # Each body field the refusal judged, so a form marks it; empty where it judged none.
    fields: list[FLRefusedField]


class FLCreatedResponse(BaseReadModel):
    """The id a create minted, which the caller reads the new record by."""

    created_id: CustomObjectId


class FLVersionResponse(BaseReadModel):
    """The record's version after an editor's save, which the editor's next save sends."""

    version: CustomVersion


class FLSweepSaisonsResponse(BaseReadModel):
    """The seasons a system pass visits, for its caller to sweep one by one in the order given."""

    saison_ids: list[str]


class FLSaisonRetentionResponse(BaseReadModel):
    """One season's pass over its season rows, fixture answers and match reports: the rows it passed over, which the next pass meets again."""

    # One sum over every clock rather than a count per clock: the line logging each row names its clock.
    failed: int
