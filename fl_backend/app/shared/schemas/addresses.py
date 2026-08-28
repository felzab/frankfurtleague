from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.shared.schemas.bounds import (
    ADDRESS_HAUSNUMMER_MAX_LENGTH,
    ADDRESS_STADT_MAX_LENGTH,
    ADDRESS_STADTTEIL_MAX_LENGTH,
    ADDRESS_STRASSE_MAX_LENGTH,
)
from app.shared.schemas.custom import CustomNonEmptyString

# Named because the payload below redeclares the field to add a ceiling: spelling the alphabet
# twice would let the read and the write drift apart on which characters a house number may use.
HAUSNUMMER_PATTERN = r"^([0-9\-abcABC]+)?$"


# The SOURCE OF TRUTH; `fl_frontend/src/shared/schemas.ts :: FLAddressSchema` mirrors it by hand.
class FLAddress(BaseModel):
    strasse: CustomNonEmptyString
    # Not every venue has one, so the pattern allows the empty string rather than being optional.
    hausnummer: str = Field(pattern=HAUSNUMMER_PATTERN)
    plz: str = Field(pattern=r"^[0-9]{5}$")
    stadtteil: str
    stadt: CustomNonEmptyString

    @property
    def to_string(self) -> str:
        return f"{self.strasse} {self.hausnummer}, {self.plz} {self.stadtteil} {self.stadt}"


# What every WRITE payload embeds. The ceilings are here and not on `FLAddress`, which a read model
# embeds: refusing a stored value there would answer 500 for a whole list over one row
# (`docs/backend/spec.md :: I36`).
class FLAddressPayload(FLAddress):
    model_config = ConfigDict(extra="forbid")

    # Redeclared, so the floor `CustomNonEmptyString` carries is restated beside the new ceiling --
    # and STRIPPED first, because a floor counting characters takes spaces alone.
    strasse: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=ADDRESS_STRASSE_MAX_LENGTH)]
    stadt: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=ADDRESS_STADT_MAX_LENGTH)]
    # No floor: a district is the one part of an address a place can genuinely lack, so the read
    # model leaves it free and the payload bounds only its length.
    stadtteil: str = Field(max_length=ADDRESS_STADTTEIL_MAX_LENGTH)

    # The pattern is restated for the same reason: a redeclaration replaces the field outright, and
    # the alphabet alone bounds nothing -- a bare `+` admits a value no address line can hold.
    hausnummer: str = Field(pattern=HAUSNUMMER_PATTERN, max_length=ADDRESS_HAUSNUMMER_MAX_LENGTH)
