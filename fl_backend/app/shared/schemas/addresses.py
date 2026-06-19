from pydantic import BaseModel, Field


class FLAddress(BaseModel):
    strasse: str
    hausnummer: str
    plz: str = Field(min_length=5, max_length=5)
    stadtteil: str
    stadt: str
