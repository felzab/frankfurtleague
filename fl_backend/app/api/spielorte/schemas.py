"""
SPIELORTE · models

The venue read model plus the three admin payloads.

`maps_link` is absent from every payload on purpose: it is derived server-side from name and address,
so a client cannot set it. `mietpreis` carries no default -- the admin patch writes payloads back
wholesale, so a default would let an omitted field overwrite a real rent with 0.
"""

from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.shared.schemas.addresses import FLAddress
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.responses import BaseAPIResponse


class FLPatchSpielortPayload(BaseModel):
    id: CustomObjectId
    address: FLAddress
    name: str = Field(min_length=1)
    default_mietpreis: int = Field(ge=0)


class FLPostSpielortPayload(BaseModel):
    address: FLAddress
    name: str = Field(min_length=1)
    default_mietpreis: int = Field(ge=0)


class FLDeleteSpielortPayload(BaseModel):
    id: CustomObjectId


class FLSpielort(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through
    address: FLAddress
    name: str = Field(min_length=1)
    # Free text (venue name + address) searched on Google Maps, NOT a URL -- so no scheme check.
    maps_link: str = Field(min_length=1)
    default_mietpreis: int = Field(ge=0)
    is_inactive: bool


FLSpielorteListAdapter = TypeAdapter(list[FLSpielort])


class FLSpielorteFilterParams(BaseModel):
    is_inactive: bool | None = False  # Exclude incactive Spielorte by default

    limit: int = Field(1024, ge=1, le=1024)
    sort_by: Literal["name",] = Field(default="name")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSpielorteListResponse(BaseAPIResponse):
    spielorte: list[FLSpielort]


class FLPostSpielortResponse(BaseAPIResponse):
    created_id: CustomObjectId


class FLPatchSpielortResponse(BaseAPIResponse):
    updated_document: FLSpielort


class FLDeleteSpielortResponse(BaseAPIResponse):
    updated_document: FLSpielort
