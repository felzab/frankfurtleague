from typing import Annotated

from pydantic import BaseModel, BeforeValidator, EmailStr, StringConstraints

from app.shared.schemas.bounds import KONTAKT_EMAIL_MAX_LENGTH
from app.shared.schemas.custom import CustomOptionalPhoneString, parse_empty_string_to_none

# An empty string coerces to `None` BEFORE validation: an untouched box is "not provided".
# `fl_frontend/src/shared/schemas.ts :: FLKontaktSchema` mirrors it and the ceiling declared
# here, which `email-validator` would otherwise own.
CustomOptionalEmail = Annotated[
    EmailStr | None, StringConstraints(max_length=KONTAKT_EMAIL_MAX_LENGTH), BeforeValidator(parse_empty_string_to_none)
]


class FLKontakt(BaseModel):
    telefon: CustomOptionalPhoneString
    email: CustomOptionalEmail
