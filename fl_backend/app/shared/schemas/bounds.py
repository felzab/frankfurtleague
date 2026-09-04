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

# A fixture's admin note, bounded on the payload alone: a season replace or undraw logs every
# removed fixture whole in ONE row (I48), and this bound is what keeps that row under BSON's
# document ceiling by construction rather than by luck.
SPIEL_NOTIZ_MAX_LENGTH: Final = 4096

# Why an application was declined, bounded where an `austritt`'s `grund` is not: this one is composed
# into an outbound email as well as stored. Named so the frontend mirror refuses at the same length.
BEWERBUNG_GRUND_MAX_LENGTH: Final = 1000

# How old a contact person on a PUBLIC application may be, in whole years against the German day it
# arrives on. The ceiling refuses a mistyped century rather than a real age. Named so the input
# control and the Zod mirror refuse at the same two numbers.
BEWERBUNG_KONTAKT_MIN_AGE_YEARS: Final = 16
BEWERBUNG_KONTAKT_MAX_AGE_YEARS: Final = 120

# How long an application's three people have to confirm their own seats before it is deleted; a
# re-send restarts the clock. Days rather than a date, so the deadline is derived from the mint and
# never stored twice.
BEWERBUNG_BESTAETIGUNG_FRIST_TAGE: Final = 14
# When the one reminder goes out, counted from the mint: early enough that a week is left after it.
BEWERBUNG_ERINNERUNG_TAGE: Final = 3

# The raw confirmation token as it arrives on the two public consent endpoints. Wide over the 43
# characters `secrets.token_urlsafe(32)` mints, and a ceiling all the same: an anonymous caller
# posts it.
BEWERBUNG_TOKEN_MAX_LENGTH: Final = 128

# What kit the school already owns, in its own words. Bounded on the pair that earns
# `BEWERBUNG_GRUND_MAX_LENGTH` its own: an anonymous caller writes it, and it is stored. Lower,
# because a colour, a count and a size need nothing like a page.
BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH: Final = 500

# A club's short name, on the public application and the admin payloads alike: both tiers refuse at
# one ceiling. `name` reaches the junction row, every fixture side and the league table.
TEAM_NAME_MAX_LENGTH: Final = 60
# The school's official name, which stands on its own page rather than in a table cell, so it takes
# the place suffix a short name drops -- "… Kooperative Gesamtschule der Stadt Frankfurt am Main".
TEAM_FULL_NAME_MAX_LENGTH: Final = 120

# A school's homepage. `validate_external_url` reads the scheme and the host and leaves the PATH and
# QUERY unchecked, so this bounds them. Far under what browsers accept: this is a front page.
TEAM_WEBSITE_URL_MAX_LENGTH: Final = 300

# The opponent a school would like on the first Spieltag, typed freely rather than picked. It takes
# `TEAM_FULL_NAME_MAX_LENGTH`'s width: nothing holds an applicant to a league short name.
BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH: Final = 120

# One part of one contact person's name, on the public application and the junction patch alike.
# `PERSON_NAME_PATTERN` bounds the ALPHABET and not the length. Generous against a hyphenated
# double name and a multi-part surname both.
KONTAKT_NAME_MAX_LENGTH: Final = 80

# The school's estimate of its squad, and the strong players inside it. A ceiling that is a SQUAD
# SIZE, not `int32`: past this the number is a typo. Not the season's `max_kadergroesse`, which an
# application is held true against nothing of.
BEWERBUNG_KADER_GROESSE_MAX: Final = 200

TEAM_SHORTHAND_LENGTH: Final = 2

SAISON_ID_LENGTH: Final = 4

# Two names for one number, deliberately: one answers what a client may ask for, the other what it
# gets by asking for nothing. Collapsing them would let a raised ceiling raise every page as well.
LIST_LIMIT_DEFAULT: Final = 1024
LIST_LIMIT_MAX: Final = 1024

# How long the action log keeps a row, counted from the write it recorded. Seconds because that is
# the unit `create_index(expireAfterSeconds=)` takes, and a plain year because the database counts
# no calendar months.
AKTION_RETENTION_SECONDS: Final = 365 * 24 * 60 * 60
