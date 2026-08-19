from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.shared.schemas.addresses import FLAddress
from app.shared.schemas.custom import CustomObjectId, CustomOptionalDateString
from app.shared.schemas.responses import BaseAPIResponse


# No `id` on any payload: the path names the venue, the body describes the change (RFC 5789).
class FLPatchSpielortPayload(BaseModel):
    address: FLAddress
    name: str = Field(min_length=1)
    # No default: the patch writes the payload back wholesale, so one would overwrite a real rent
    # with 0.
    default_mietpreis: int = Field(ge=0)


class FLPostSpielortPayload(BaseModel):
    address: FLAddress
    name: str = Field(min_length=1)
    default_mietpreis: int = Field(ge=0)


class FLSpielort(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    address: FLAddress
    name: str = Field(min_length=1)
    # Free text searched on Google Maps, not a URL, so there is no scheme to check.
    maps_link: str = Field(min_length=1)
    default_mietpreis: int = Field(ge=0)
    # On no payload: deactivation goes through the delete endpoint, which stamps the date itself.
    inactive_since: CustomOptionalDateString


FLSpielorteListAdapter = TypeAdapter(list[FLSpielort])


class FLSpielorteFilterParams(BaseModel):
    # A switch, not a value to match on: a caller wanting the retired venues wants them ALONGSIDE
    # the live ones.
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
