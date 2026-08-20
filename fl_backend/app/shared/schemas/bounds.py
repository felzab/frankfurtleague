"""
SHARED · the bounds more than one schema states

Named here so two slices spelling the same limit cannot drift apart. A bound only one field states
stays at that field, and a derived one is never re-spelled as a literal.
"""

from typing import Final

# The two free-text halves of an address; `hausnummer` and `plz` carry patterns instead. Stated by
# the payload address alone, so a stored value over either ceiling still reads.
ADDRESS_STRASSE_MAX_LENGTH: Final = 120
ADDRESS_STADT_MAX_LENGTH: Final = 80

TEAM_DESCRIPTION_MAX_LENGTH: Final = 4096

TEAM_SHORTHAND_LENGTH: Final = 2

SAISON_ID_LENGTH: Final = 4

# Two names for one number, deliberately: one answers what a client may ask for, the other what it
# gets by asking for nothing. Collapsing them would let a raised ceiling raise every page as well.
LIST_LIMIT_DEFAULT: Final = 1024
LIST_LIMIT_MAX: Final = 1024
