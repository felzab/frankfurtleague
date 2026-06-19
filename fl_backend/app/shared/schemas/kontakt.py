from pydantic import BaseModel


class FLKontakt(BaseModel):
    telefon: str | None
    email: str | None
