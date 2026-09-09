from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, EmailStr, StringConstraints

from app.shared.schemas.bounds import KONTAKT_EMAIL_MAX_LENGTH
from app.shared.schemas.custom import CustomOptionalPhoneString, parse_empty_string_to_none

# An empty string coerces to `None` BEFORE validation: an untouched box is "not provided".
# `fl_frontend/src/shared/schemas.ts :: KontaktEmailSchema` mirrors it and the ceiling declared
# here, which `email-validator` would otherwise own.
CustomOptionalEmail = Annotated[
    EmailStr | None, StringConstraints(max_length=KONTAKT_EMAIL_MAX_LENGTH), BeforeValidator(parse_empty_string_to_none)
]


# Neither member carries a rule (`docs/backend/spec.md :: I104`): a stored number the phone rule was
# narrowed past would answer 500 for the whole referee list over one row.
class FLKontakt(BaseModel):
    # No empty-string coercion either, as `FLSchiedsrichter.schule` has none: a read answers the
    # value as stored rather than a repaired copy of it.
    telefon: str | None
    email: str | None


# What both referee payloads embed. The address rule belongs where a refusal reaches a box, and
# `email-validator`'s own tables move without us, so a read judging one ages into a 500.
class FLKontaktPayload(FLKontakt):
    # Derived from the read shape and never the other way round: `extra` is inherited, so forbidding
    # on a base would refuse a stored key the collection has grown (`docs/backend/spec.md :: I114`).
    model_config = ConfigDict(extra="forbid")

    telefon: CustomOptionalPhoneString
    email: CustomOptionalEmail
