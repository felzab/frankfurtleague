from typing import Annotated

from pydantic import BaseModel, BeforeValidator, EmailStr

from app.shared.schemas.custom import CustomOptionalPhoneString, parse_empty_string_to_none

# An empty string coerces to `None` BEFORE validation, so an untouched form box means "not
# provided". `fl_frontend/src/shared/schemas.ts :: FLKontaktSchema` mirrors this.
CustomOptionalEmail = Annotated[EmailStr | None, BeforeValidator(parse_empty_string_to_none)]


class FLKontakt(BaseModel):
    telefon: CustomOptionalPhoneString
    email: CustomOptionalEmail
