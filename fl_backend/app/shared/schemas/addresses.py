from pydantic import BaseModel, Field


# Constraints mirror fl_frontend/src/shared/schemas.ts FLAddressSchema. The backend is the source
# of truth; the frontend keeps the same rules so a bad value is rejected at both ends.
class FLAddress(BaseModel):
    strasse: str = Field(min_length=1)
    # May be empty -- not every venue has a house number -- but otherwise digits, hyphens and a/b/c.
    hausnummer: str = Field(pattern=r"^([0-9\-abcABC]+)?$")
    plz: str = Field(pattern=r"^[0-9]{5}$")
    stadtteil: str
    stadt: str = Field(min_length=1)

    @property
    def to_string(self) -> str:
        return f"{self.strasse} {self.hausnummer}, {self.plz} {self.stadtteil} {self.stadt}"
