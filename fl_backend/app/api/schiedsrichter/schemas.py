from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.shared.schemas.custom_types import CustomObjectId
from app.shared.schemas.kontakt import FLKontakt
from app.shared.schemas.responses import BaseAPIResponse


class FLSchiedsrichter(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through
    name: str
    schule: str | None
    default_payment: int
    kontakt: FLKontakt


FLSchiedsrichterListAdapter = TypeAdapter(list[FLSchiedsrichter])


class FLSchiedsrichterFilterParams(BaseModel):
    default_payment: int | None = None

    limit: int = Field(1024, ge=1, le=1024)
    sort_by: Literal["name", "default_payment"] = Field(default="name")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSchiedsrichterListResponse(BaseAPIResponse):
    schiedsrichter: list[FLSchiedsrichter]
