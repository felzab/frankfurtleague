from typing import Annotated, Final

from pydantic import AfterValidator, BaseModel, Field, StringConstraints

from app.shared.schemas.addresses import FLAddress, FLAddressPayload
from app.shared.schemas.bounds import TEAM_FULL_NAME_MAX_LENGTH
from app.shared.schemas.custom import CustomNonEmptyString, CustomObjectId, CustomOptionalDateString, CustomVersion
from app.shared.schemas.responses import BasePayload, BaseReadModel


# Private, so the payloads and the read model state these fields once: a base no endpoint names
# publishes no OpenAPI component.
class _SpielortWritable(BaseModel):
    address: FLAddress
    name: CustomNonEmptyString
    # No default: the patch writes the payload back wholesale, so one would overwrite a real rent
    # with 0.
    default_mietpreis: int = Field(ge=0)


# A ground's name, which every fixture at it shows and `maps_query` composes, takes a school's full name's width.
SPIELORT_NAME_MAX_LENGTH: Final = TEAM_FULL_NAME_MAX_LENGTH


# No `id` on any payload: the path names the venue, the body describes the change (RFC 5789). The
# bounded address sits here rather than on the writable base, which the read model shares.
class _SpielortPayload(_SpielortWritable, BasePayload):
    address: FLAddressPayload
    # Stripped on the write side alone: the name is shown on every fixture at this ground and composed into
    # `maps_query`, so spaces alone reach both. The ceiling counts what arrives, so the published `maxLength` is what the
    # write accepts.
    name: Annotated[str, StringConstraints(max_length=SPIELORT_NAME_MAX_LENGTH), AfterValidator(str.strip), StringConstraints(min_length=1)]


class FLPatchSpielortPayload(_SpielortPayload):
    version: CustomVersion


class FLPostSpielortPayload(_SpielortPayload):
    pass


class FLSpielort(_SpielortWritable, BaseReadModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    # Free text searched on Google Maps, so there is no scheme to check. The copy a fixture's
    # read joins is the public address surface, which is why `address` here need not be.
    maps_query: CustomNonEmptyString
    # On no payload: deactivation goes through the delete endpoint, which stamps the date itself.
    inactive_since: CustomOptionalDateString
    # The writes counted so far, which the editor's save sends back.
    version: int


class FLSpielorteListResponse(BaseReadModel):
    spielorte: list[FLSpielort]


class FLSpielorteSingleResponse(BaseReadModel):
    spielort: FLSpielort
