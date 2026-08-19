"""
SPIELORTE · models

The venue read model plus the admin payloads.

`maps_link` is absent from every payload on purpose: it is derived server-side from name and address,
so a client cannot set it. `default_mietpreis` carries no default -- the admin patch writes payloads
back wholesale, so a default would let an omitted field overwrite a real rent with 0.

`inactive_since` is absent from every payload for a different reason: deactivation goes through the
delete endpoint, which stamps the date itself, so a client never chooses when something was retired.
"""

from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.shared.schemas.addresses import FLAddress
from app.shared.schemas.custom import CustomObjectId, CustomOptionalDateString
from app.shared.schemas.responses import BaseAPIResponse


# No `id` on any payload: the venue being changed is named by the path (RFC 5789 -- the Request-URI
# identifies the resource, the body describes the change).
class FLPatchSpielortPayload(BaseModel):
    address: FLAddress
    name: str = Field(min_length=1)
    default_mietpreis: int = Field(ge=0)


class FLPostSpielortPayload(BaseModel):
    address: FLAddress
    name: str = Field(min_length=1)
    default_mietpreis: int = Field(ge=0)


class FLSpielort(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    address: FLAddress
    name: str = Field(min_length=1)
    # Free text (venue name + address) searched on Google Maps, NOT a URL -- so no scheme check.
    maps_link: str = Field(min_length=1)
    default_mietpreis: int = Field(ge=0)
    # The day this venue was retired, or null while it is live.
    inactive_since: CustomOptionalDateString


FLSpielorteListAdapter = TypeAdapter(list[FLSpielort])


class FLSpielorteFilterParams(BaseModel):
    # A switch, not a value to match on: "inactive" is a date, and a caller wanting the retired venues
    # wants them ALONGSIDE the live ones -- an admin list showing what may be reactivated.
    include_inactive: bool = False

    limit: int = Field(default=1024, ge=1, le=1024)
    sort_by: Literal["name",] = Field(default="name")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSpielorteListResponse(BaseAPIResponse):
    spielorte: list[FLSpielort]


class FLPostSpielortResponse(BaseAPIResponse):
    created_id: CustomObjectId


class FLPatchSpielortResponse(BaseAPIResponse):
    updated_document: FLSpielort


class FLSpielortWriteResponse(BaseAPIResponse):
    """Shared by delete and reactivate — both answer with the venue as it now stands."""

    updated_document: FLSpielort


class FLSpielorteSingleResponse(BaseAPIResponse):
    spielort: FLSpielort
