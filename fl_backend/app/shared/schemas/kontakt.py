"""
SHARED · contact details

Phone and email, both optional, embedded on referees.

An empty string coerces to `None` BEFORE validation, so a cleared form field means "not provided"
rather than "malformed address". Without that, submitting a form with an untouched email box would
fail validation on a field the user never filled in.
"""

from typing import Annotated

from pydantic import BaseModel, BeforeValidator, EmailStr

from app.shared.schemas.custom import CustomOptionalPhoneString, parse_empty_string_to_none

# `fl_frontend/src/shared/schemas.ts :: FLKontaktSchema` mirrors this.
CustomOptionalEmail = Annotated[EmailStr | None, BeforeValidator(parse_empty_string_to_none)]


class FLKontakt(BaseModel):
    telefon: CustomOptionalPhoneString
    email: CustomOptionalEmail
