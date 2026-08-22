from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.shared.schemas.addresses import FLAddress, FLAddressPayload
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX
from app.shared.schemas.custom import CustomNonEmptyString, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.responses import BaseAPIResponse


# Private, so the payloads and the read model state these fields once: a base no endpoint names
# publishes no OpenAPI component.
class _SpielortWritable(BaseModel):
    address: FLAddress
    name: CustomNonEmptyString
    # No default: the patch writes the payload back wholesale, so one would overwrite a real rent
    # with 0.
    default_mietpreis: int = Field(ge=0)


# No `id` on any payload: the path names the venue, the body describes the change (RFC 5789). The
# bounded address sits here rather than on the writable base, which the read model shares.
class _SpielortPayload(_SpielortWritable):
    address: FLAddressPayload


class FLPatchSpielortPayload(_SpielortPayload):
    pass


class FLPostSpielortPayload(_SpielortPayload):
    pass


class FLSpielort(_SpielortWritable):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    # Free text searched on Google Maps, not a URL, so there is no scheme to check. The copy a
    # fixture embeds is the public address surface, which is why `address` here need not be
    # (`READ-ADDRESS-001`).
    maps_link: CustomNonEmptyString
    # On no payload: deactivation goes through the delete endpoint, which stamps the date itself.
    inactive_since: CustomOptionalDateString


FLSpielortListAdapter = TypeAdapter(list[FLSpielort])


class FLSpielorteFilterParams(BaseModel):
    # A switch, not a value to match on: a caller wanting the retired venues wants them ALONGSIDE
    # the live ones.
    include_inactive: bool = False

    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    sort_by: Literal["name",] = Field(default="name")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSpielorteListResponse(BaseAPIResponse):
    spielorte: list[FLSpielort]


class FLPostSpielortResponse(BaseAPIResponse):
    created_id: CustomObjectId


class FLPatchSpielortResponse(BaseAPIResponse):
    updated_document: FLSpielort
    # Reported rather than assumed: this fan-out is the half of the endpoint that fails silently (`docs/backend/spec.md :: I13`).
    fanned_out_to_spiele: int


class FLSpielortWriteResponse(BaseAPIResponse):
    """Shared by delete and reactivate — both answer with the venue as it now stands."""

    updated_document: FLSpielort


class FLSpielorteSingleResponse(BaseAPIResponse):
    spielort: FLSpielort
