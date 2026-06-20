from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.shared.schemas.addresses import FLAddress
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.responses import BaseAPIResponse


class FLSpielort(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through
    address: FLAddress
    name: str
    maps_link: str
    default_mietpreis: int


FLSpielorteListAdapter = TypeAdapter(list[FLSpielort])


class FLSpielorteFilterParams(BaseModel):
    limit: int = Field(1024, ge=1, le=1024)
    sort_by: Literal["name"] = Field(default="name")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSpielorteListResponse(BaseAPIResponse):
    spielorte: list[FLSpielort]
