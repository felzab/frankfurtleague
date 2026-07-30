from typing import Annotated

from pydantic import BaseModel, BeforeValidator, EmailStr

from app.shared.schemas.custom import CustomOptionalPhoneString, parse_empty_string_to_none

# Empty string coerces to None before validation, so "" means "not provided" rather than a
# malformed address. Mirrors FLKontaktSchema in fl_frontend/src/shared/schemas.ts.
CustomOptionalEmail = Annotated[EmailStr | None, BeforeValidator(parse_empty_string_to_none)]


class FLKontakt(BaseModel):
    telefon: CustomOptionalPhoneString
    email: CustomOptionalEmail
