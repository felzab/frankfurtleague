from pydantic import BaseModel

from app.shared.schemas.custom import CustomOptionalString


class FLKontakt(BaseModel):
    telefon: CustomOptionalString
    email: CustomOptionalString
