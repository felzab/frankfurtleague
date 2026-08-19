from pydantic import BaseModel, Field


# The SOURCE OF TRUTH; `fl_frontend/src/shared/schemas.ts :: FLAddressSchema` mirrors it by hand.
class FLAddress(BaseModel):
    strasse: str = Field(min_length=1)
    # Not every venue has one, so the pattern allows the empty string rather than being optional.
    hausnummer: str = Field(pattern=r"^([0-9\-abcABC]+)?$")
    plz: str = Field(pattern=r"^[0-9]{5}$")
    stadtteil: str
    stadt: str = Field(min_length=1)

    @property
    def to_string(self) -> str:
        return f"{self.strasse} {self.hausnummer}, {self.plz} {self.stadtteil} {self.stadt}"
