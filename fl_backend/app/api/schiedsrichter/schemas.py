"""
SCHIEDSRICHTER · models

The referee read model plus the admin payloads.

`inactive_since` is absent from every payload: deactivation goes through the delete endpoint rather than
a patch, so there is one route to it and the server stamps the date. `default_payment` carries no
default, for the same reason as a venue's `default_mietpreis` -- the patch writes wholesale.
"""

from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.api.spieler.schemas import PERSON_NAME_PATTERN
from app.shared.schemas.custom import CustomObjectId, CustomOptionalDateString, CustomOptionalString
from app.shared.schemas.kontakt import FLKontakt
from app.shared.schemas.responses import BaseAPIResponse


# No `id` on any payload: the referee being changed is named by the path (RFC 5789 -- the Request-URI
# identifies the resource, the body describes the change).
class FLPostSchiedsrichterPayload(BaseModel):
    kontakt: FLKontakt
    name: str = Field(min_length=1, pattern=PERSON_NAME_PATTERN)
    schule: CustomOptionalString
    default_payment: int = Field(ge=0)


class FLPatchSchiedsrichterPayload(BaseModel):
    kontakt: FLKontakt
    name: str = Field(min_length=1, pattern=PERSON_NAME_PATTERN)
    schule: CustomOptionalString
    default_payment: int = Field(ge=0)


class FLSchiedsrichter(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    # NO name pattern here, unlike the two payloads above, and the asymmetry is the point: a READ
    # model that refused a stored name would answer 500 for the whole list because of one row rather
    # than showing it. The rule belongs on the way IN.
    name: str = Field(min_length=1)
    schule: str | None
    default_payment: int = Field(ge=0)
    kontakt: FLKontakt
    # The day this referee was retired, or null while they are available.
    inactive_since: CustomOptionalDateString


FLSchiedsrichterListAdapter = TypeAdapter(list[FLSchiedsrichter])


class FLSchiedsrichterFilterParams(BaseModel):
    default_payment: int | None = None
    include_inactive: bool = False

    limit: int = Field(default=1024, ge=1, le=1024)
    sort_by: Literal["name", "default_payment"] = Field(default="name")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSchiedsrichterListResponse(BaseAPIResponse):
    schiedsrichter: list[FLSchiedsrichter]


class FLPostSchiedsrichterResponse(BaseAPIResponse):
    created_id: CustomObjectId


class FLPatchSchiedsrichterResponse(BaseAPIResponse):
    updated_document: FLSchiedsrichter


class FLSchiedsrichterWriteResponse(BaseAPIResponse):
    """Shared by delete and reactivate — both answer with the referee as they now stand."""

    updated_document: FLSchiedsrichter


class FLSchiedsrichterSingleResponse(BaseAPIResponse):
    schiedsrichter: FLSchiedsrichter
