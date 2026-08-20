from pydantic import BaseModel, Field

from app.shared.schemas.bounds import ADDRESS_STADT_MAX_LENGTH, ADDRESS_STRASSE_MAX_LENGTH
from app.shared.schemas.custom import CustomNonEmptyString


# The SOURCE OF TRUTH; `fl_frontend/src/shared/schemas.ts :: FLAddressSchema` mirrors it by hand.
class FLAddress(BaseModel):
    strasse: CustomNonEmptyString
    # Not every venue has one, so the pattern allows the empty string rather than being optional.
    hausnummer: str = Field(pattern=r"^([0-9\-abcABC]+)?$")
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
    # Redeclared, so the floor `CustomNonEmptyString` carries is restated beside the new ceiling.
    strasse: str = Field(min_length=1, max_length=ADDRESS_STRASSE_MAX_LENGTH)
    stadt: str = Field(min_length=1, max_length=ADDRESS_STADT_MAX_LENGTH)
