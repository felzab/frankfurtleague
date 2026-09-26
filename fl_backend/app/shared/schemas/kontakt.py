from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.shared.folding import league_address
from app.shared.schemas.bounds import KONTAKT_EMAIL_MAX_LENGTH, KONTAKT_NAME_MAX_LENGTH
from app.shared.schemas.custom import PERSON_NAME_PATTERN, CustomOptionalPhoneString

# Every address payload's type but the erasure's lookup (`docs/backend/spec.md :: I329`).
# Never `EmailStr`, which never turns `allow_smtputf8` off and so stores a Unicode local part and
# domain. The ceiling and the format are stated so the published schema carries both.
CustomEmail = Annotated[
    str, StringConstraints(max_length=KONTAKT_EMAIL_MAX_LENGTH), AfterValidator(league_address), Field(json_schema_extra={"format": "email"})
]

# A person's name, or one part of one: what the public application form takes, and every payload
# held to refuse what that form refuses, a referee's whole name among them.
CustomKontaktName = Annotated[
    str,
    # Stripped first, so the padding the pattern's trailing space class admits is never stored and
    # never shown wherever the name is read back, a pupil's squad sheet among them.
    StringConstraints(strip_whitespace=True, min_length=1, max_length=KONTAKT_NAME_MAX_LENGTH, pattern=PERSON_NAME_PATTERN),
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
    # Required where the telephone is not: an administrator enters a referee, and the address is the
    # only route by which that person learns they were entered (Art. 14(3) GDPR).
    email: CustomEmail
