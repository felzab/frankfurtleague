from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.shared.schemas.bounds import (
    ADDRESS_CITY_MAX_LENGTH,
    ADDRESS_DISTRICT_MAX_LENGTH,
    ADDRESS_HOUSE_NUMBER_MAX_LENGTH,
    ADDRESS_POSTCODE_LENGTH,
    ADDRESS_STREET_MAX_LENGTH,
)
from app.shared.schemas.custom import CustomNonEmptyString

# Named because the payload below redeclares the field to add a ceiling: spelling the alphabet
# twice would let the read and the write drift apart on which characters a house number may use.
HOUSE_NUMBER_PATTERN = r"^([0-9\-abcABC]+)?$"
POSTCODE_PATTERN = rf"^[0-9]{{{ADDRESS_POSTCODE_LENGTH}}}$"


def _join_present(parts: tuple[str, ...], separator: str) -> str:
    # `strip`, because `district` is stored unstripped: a part of spaces alone would still take a separator.
    return separator.join(part for part in parts if part.strip())


class FLAddress(BaseModel):
    street: CustomNonEmptyString
    # Not every venue has one, so the pattern allows the empty string rather than being optional.
    house_number: str = Field(pattern=HOUSE_NUMBER_PATTERN)
    postcode: str = Field(pattern=POSTCODE_PATTERN)
    district: str
    city: CustomNonEmptyString

    @property
    def to_string(self) -> str:
        # Joined, so a blank part leaves no „Feldweg , 60437“ in the stored `maps_link`.
        street = _join_present((self.street, self.house_number), " ")
        locality = _join_present((self.postcode, self.district, self.city), " ")

        return _join_present((street, locality), ", ")


# What every write payload embeds. The ceilings are here and not on `FLAddress`, which a read model
# embeds: refusing a stored value there would answer 500 for a whole list over one row.
class FLAddressPayload(FLAddress):
    model_config = ConfigDict(extra="forbid")

    # Redeclared, so the floor `CustomNonEmptyString` carries is restated beside the new ceiling. The
    # ceiling counts what arrives and the floor what the strip leaves, because a floor counting
    # characters takes spaces alone.
    street: Annotated[str, StringConstraints(max_length=ADDRESS_STREET_MAX_LENGTH), AfterValidator(str.strip), StringConstraints(min_length=1)]
    city: Annotated[str, StringConstraints(max_length=ADDRESS_CITY_MAX_LENGTH), AfterValidator(str.strip), StringConstraints(min_length=1)]
    # No floor: a district is the one part of an address a place can genuinely lack, so the read
    # model leaves it free and the payload bounds only its length.
    district: str = Field(max_length=ADDRESS_DISTRICT_MAX_LENGTH)

    # The pattern is restated for the same reason: a redeclaration replaces the field outright, and
    # the alphabet alone bounds nothing -- a bare `+` admits a value no address line can hold.
    house_number: str = Field(pattern=HOUSE_NUMBER_PATTERN, max_length=ADDRESS_HOUSE_NUMBER_MAX_LENGTH)
    # Both bounds published beside the pattern, so a form's box holds the postcode's length from the contract.
    postcode: str = Field(pattern=POSTCODE_PATTERN, min_length=ADDRESS_POSTCODE_LENGTH, max_length=ADDRESS_POSTCODE_LENGTH)
