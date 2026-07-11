from pydantic import BaseModel, Field


class FLAddress(BaseModel):
    strasse: str
    hausnummer: str
    plz: str = Field(min_length=5, max_length=5)
    stadtteil: str
    stadt: str

    @property
    def to_string(self) -> str:
        return f"{self.strasse} {self.hausnummer}, {self.plz} {self.stadtteil} {self.stadt}"
