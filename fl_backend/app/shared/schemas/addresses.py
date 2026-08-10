"""
SHARED · postal address

German addresses, embedded on teams and venues.

The backend is the SOURCE OF TRUTH for these constraints and the frontend mirrors them, so a bad value
is rejected at both ends. `hausnummer` may be empty -- not every venue has one -- which is why its
pattern allows the empty string rather than being made optional.
"""

from pydantic import BaseModel, Field


# `fl_frontend/src/shared/schemas.ts :: FLAddressSchema` mirrors these constraints.
class FLAddress(BaseModel):
    strasse: str = Field(min_length=1)
    hausnummer: str = Field(pattern=r"^([0-9\-abcABC]+)?$")
    plz: str = Field(pattern=r"^[0-9]{5}$")
    stadtteil: str
    stadt: str = Field(min_length=1)

    @property
    def to_string(self) -> str:
        return f"{self.strasse} {self.hausnummer}, {self.plz} {self.stadtteil} {self.stadt}"
