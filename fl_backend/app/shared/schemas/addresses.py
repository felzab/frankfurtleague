from pydantic import BaseModel, Field

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
