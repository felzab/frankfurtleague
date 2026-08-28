"""
SHARED · the bounds more than one schema states

Named here so two slices spelling the same limit cannot drift apart. A bound only one field states
stays at that field, and a derived one is never re-spelled as a literal.
"""

from typing import Final

# The address ceilings, stated by the payload address alone so a stored value over one still reads.
# `plz` carries none: its own pattern already fixes the width exactly.
ADDRESS_STRASSE_MAX_LENGTH: Final = 120
ADDRESS_STADT_MAX_LENGTH: Final = 80
# Its own constant rather than `stadt`'s, though the numbers agree: a district and a city are bounded
# for the same reason and by separate judgements, so raising one must not silently raise the other.
ADDRESS_STADTTEIL_MAX_LENGTH: Final = 80

# Wide enough for a hyphenated range carrying a letter suffix, the longest thing the field's
# alphabet of digits, a hyphen and a/b/c can spell as a real address. Anything longer is not one.
ADDRESS_HAUSNUMMER_MAX_LENGTH: Final = 16

# RFC 5321's whole-address ceiling, the one `EmailStr` already applies through email-validator.
# Named so the frontend mirror refuses at the same length: past it the API answers a bare
# REQ-VAL-001 with no field detail, so no error reaches the box.
KONTAKT_EMAIL_MAX_LENGTH: Final = 254

# The identifier of the consent WORDING a contact person was shown, not the wording itself: the
# text is versioned in the frontend, so what a row stores is a short tag and nothing longer is one.
EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH: Final = 64

TEAM_DESCRIPTION_MAX_LENGTH: Final = 4096

# Why an application was declined, bounded where an `austritt`'s `grund` is not: this one is composed
# into an outbound email as well as stored. Named so the frontend mirror refuses at the same length.
BEWERBUNG_GRUND_MAX_LENGTH: Final = 1000

TEAM_SHORTHAND_LENGTH: Final = 2

SAISON_ID_LENGTH: Final = 4

# Two names for one number, deliberately: one answers what a client may ask for, the other what it
# gets by asking for nothing. Collapsing them would let a raised ceiling raise every page as well.
LIST_LIMIT_DEFAULT: Final = 1024
LIST_LIMIT_MAX: Final = 1024
