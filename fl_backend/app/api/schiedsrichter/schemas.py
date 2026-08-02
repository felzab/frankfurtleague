"""
SCHIEDSRICHTER · models

The referee read model plus the three admin payloads.

`is_inactive` is absent from every payload: deactivation goes through the delete endpoint rather than a
patch, so there is one route to it. `payment` carries no default, for the same reason as a venue's
`mietpreis` -- the patch writes wholesale.
"""

from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.shared.schemas.custom import CustomObjectId, CustomOptionalString
from app.shared.schemas.kontakt import FLKontakt
from app.shared.schemas.responses import BaseAPIResponse


class FLPostSchiedsrichterPayload(BaseModel):
    kontakt: FLKontakt
    name: str = Field(min_length=1)
    schule: CustomOptionalString
    default_payment: int = Field(ge=0)


class FLPatchSchiedsrichterPayload(BaseModel):
    id: CustomObjectId
    kontakt: FLKontakt
    name: str = Field(min_length=1)
    schule: CustomOptionalString
    default_payment: int = Field(ge=0)


class FLDeleteSchiedsrichterPayload(BaseModel):
    id: CustomObjectId


class FLSchiedsrichter(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through
    name: str = Field(min_length=1)
    schule: str | None
    default_payment: int = Field(ge=0)
    kontakt: FLKontakt
    is_inactive: bool


FLSchiedsrichterListAdapter = TypeAdapter(list[FLSchiedsrichter])


class FLSchiedsrichterFilterParams(BaseModel):
    default_payment: int | None = None
    is_inactive: bool | None = False  # Exclude incactive Schiedsrichter by default

    limit: int = Field(default=1024, ge=1, le=1024)
    sort_by: Literal["name", "default_payment"] = Field(default="name")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSchiedsrichterListResponse(BaseAPIResponse):
    schiedsrichter: list[FLSchiedsrichter]


class FLPostSchiedsrichterResponse(BaseAPIResponse):
    created_id: CustomObjectId


class FLPatchSchiedsrichterResponse(BaseAPIResponse):
    updated_document: FLSchiedsrichter


class FLDeleteSchiedsrichterResponse(BaseAPIResponse):
    updated_document: FLSchiedsrichter
