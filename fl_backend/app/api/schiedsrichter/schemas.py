from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX
from app.shared.schemas.custom import PERSON_NAME_PATTERN, CustomNonEmptyString, CustomObjectId, CustomOptionalDateString, CustomOptionalString
from app.shared.schemas.kontakt import FLKontakt
from app.shared.schemas.responses import BaseAPIResponse


class _SchiedsrichterWritable(BaseModel):
    kontakt: FLKontakt
    name: CustomNonEmptyString
    schule: CustomOptionalString
    # No default, as a venue's `default_mietpreis` has none: the patch writes wholesale.
    default_payment: int = Field(ge=0)


# No `id` on any payload: the path names the referee, the body describes the change (RFC 5789).
class _SchiedsrichterPayload(_SchiedsrichterWritable):
    model_config = ConfigDict(extra="forbid")

    # Tightened on the WRITE side alone: a read model refusing a stored name would answer 500 for
    # the whole list over one row (`docs/backend/spec.md :: I36`).
    name: str = Field(min_length=1, pattern=PERSON_NAME_PATTERN)


# One shape under two names, and they stay two: each endpoint publishes its own OpenAPI component,
# which `fl_frontend/src/core/apiContract.test.ts` pairs with a Zod mirror by name.
class FLPostSchiedsrichterPayload(_SchiedsrichterPayload):
    pass


class FLPatchSchiedsrichterPayload(_SchiedsrichterPayload):
    pass


class FLSchiedsrichter(_SchiedsrichterWritable):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    # Redeclared without the payload's empty-string coercion: a read answers with the value as
    # stored, never a repaired copy of it.
    schule: str | None
    # On no payload: deactivation goes through the delete endpoint, which stamps the date itself.
    inactive_since: CustomOptionalDateString


FLSchiedsrichterListAdapter = TypeAdapter(list[FLSchiedsrichter])


class FLSchiedsrichterFilterParams(BaseModel):
    default_payment: int | None = None
    include_inactive: bool = False

    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    sort_by: Literal["name", "default_payment"] = Field(default="name")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSchiedsrichterListResponse(BaseAPIResponse):
    schiedsrichter: list[FLSchiedsrichter]


class FLPostSchiedsrichterResponse(BaseAPIResponse):
    created_id: CustomObjectId


class FLPatchSchiedsrichterResponse(BaseAPIResponse):
    updated_document: FLSchiedsrichter
    # Reported rather than assumed: this fan-out is the half of the endpoint that fails silently (`docs/backend/spec.md :: I13`).
    fanned_out_to_spiele: int


class FLSchiedsrichterWriteResponse(BaseAPIResponse):
    """Shared by delete, reactivate and anonymisieren — each answers with the referee as they now stand."""

    updated_document: FLSchiedsrichter


class FLSchiedsrichterSingleResponse(BaseAPIResponse):
    schiedsrichter: FLSchiedsrichter
