"""The bounds more than one schema states, named once so two slices cannot drift apart.

A bound only one field states stays at that field, and a derived one is never re-spelled as a literal.
"""

from typing import Final, Literal

# The address ceilings, stated by the payload address alone so a stored value over one still reads.
ADDRESS_POSTCODE_LENGTH: Final = 5
ADDRESS_STREET_MAX_LENGTH: Final = 120
ADDRESS_CITY_MAX_LENGTH: Final = 80
# Its own constant rather than `city`'s, though the numbers agree: a district and a city are bounded
# for the same reason and by separate judgements, so raising one must not silently raise the other.
ADDRESS_DISTRICT_MAX_LENGTH: Final = 80

# Wide enough for a hyphenated range carrying a letter suffix, the longest thing the field's
# alphabet of digits, a hyphen and a/b/c can spell as a real address. Anything longer is not one.
ADDRESS_HOUSE_NUMBER_MAX_LENGTH: Final = 16

# RFC 5321's whole-address ceiling, the one email-validator already applies. Published, so the frontend's address rule
# refuses at the same length: past it the API's payload_refused marks the box with a generic sentence rather than the
# length's own German.
type FLKontaktEmailMaxLength = Literal[254]
KONTAKT_EMAIL_MAX_LENGTH: Final[FLKontaktEmailMaxLength] = 254

type FLBewerbungKontaktMinAgeYears = Literal[16]
BEWERBUNG_KONTAKT_MIN_AGE_YEARS: Final[FLBewerbungKontaktMinAgeYears] = 16

# Every birth date's ceiling, in each flow taking one: it refuses a mistyped century rather than a real age.
BIRTH_DATE_MAX_AGE_YEARS: Final = 120

# The Ansprechperson's floor and the Stellvertretung's: those two sign what binds the school, which
# asks contractual capacity rather than the age a person consents for themselves at.
type FLSignatoryMinAgeYears = Literal[18]
SIGNATORY_MIN_AGE_YEARS: Final[FLSignatoryMinAgeYears] = 18

# How long every link asking a person to confirm themselves answers: an application's seat, a season row's seat, a
# pupil's registration and a referee's entry, a re-send restarting the clock. A declined application or registration
# goes this long after its decision too, as an unconfirmed one goes after its deadline, so the privacy notice states one
# figure for both. A row stores the deadline it was given, so raising this moves no link already mailed. Published, since
# the privacy notice, the mails and the link pages state it.
type FLConfirmationDeadlineDays = Literal[14]
CONFIRMATION_DEADLINE_DAYS: Final[FLConfirmationDeadlineDays] = 14

# A club's short name, on the public application and the admin payloads alike: both tiers refuse at
# one ceiling. `name` reaches the junction row, every fixture side and the league table.
TEAM_NAME_MAX_LENGTH: Final = 60
# The school's official name, which stands on its own page rather than in a table cell, so it takes
# the place suffix a short name drops -- "… Kooperative Gesamtschule der Stadt Frankfurt am Main".
TEAM_FULL_NAME_MAX_LENGTH: Final = 120

# Published as a schema of its own: the generated module holding the pattern is server-only, so the frontend's control
# caps a code at a constant of its own, which is checked against this alias.
type FLTeamShorthandLength = Literal[3]
TEAM_SHORTHAND_LENGTH: Final[FLTeamShorthandLength] = 3

# `saisons._id` is the string every `saison_id` references, so a width only one model moved breaks every row pointing
# at it.
SAISON_ID_LENGTH: Final = 4

# The most rows one list read takes: no request names a page size, so a list is cut here and a whole read refuses a set past it.
LIST_LIMIT_DEFAULT: Final = 1024

# How long the action log keeps a row, counted from the write it recorded. Published in years, which the privacy notice
# states in months; a plain year of seconds below, because the database counts no calendar months and seconds are the
# unit an index's `expireAfterSeconds` takes.
type FLActionLogRetentionYears = Literal[1]
ACTION_LOG_RETENTION_YEARS: Final[FLActionLogRetentionYears] = 1
ACTION_LOG_ENTRY_RETENTION_SECONDS: Final = ACTION_LOG_RETENTION_YEARS * 365 * 24 * 60 * 60

# One page of the Protokoll. Published as a schema of its own: „Weitere 50 laden“ states the figure, and the frontend
# checks its constant against this alias.
type FLActionLogPageSize = Literal[50]
ACTION_LOG_PAGE_SIZE: Final[FLActionLogPageSize] = 50

# How many full seasons a ban outlives the one it was entered under. The season it is entered in
# does not count, so the fifth one after it is the last the ban covers.
type FLBanDurationSaisons = Literal[5]
BAN_DURATION_SAISONS: Final[FLBanDurationSaisons] = 5

# How long a step of an address change waits from its asking: the new mailbox's link, or the question
# the person's own change asks the address on file. NIST SP 800-63B-4 `#issuedrecovery` caps an emailed recovery code
# at 24 hours.
type FLAddressChangeValidHours = Literal[24]
ADDRESS_CHANGE_VALID_HOURS: Final[FLAddressChangeValidHours] = 24

# A lost-mailbox change waits this long after its confirmation, the address
# on file free to stop it: a school week and its weekends, past any holiday weekend three days fit inside.
type FLAddressChangeWaitingPeriodDays = Literal[7]
ADDRESS_CHANGE_WAITING_PERIOD_DAYS: Final[FLAddressChangeWaitingPeriodDays] = 7

# Published as schemas of their own, though no operation names one: the privacy notice, the mails and the link page
# state both figures, and the frontend checks its constants against them, so a bound moved here alone fails the
# frontend's type check rather than the notice stating a figure the backend does not keep. Each value is typed by its
# alias, so neither moves without the other.
ADDRESS_CHANGE_BOUNDS: Final = (FLAddressChangeValidHours, FLAddressChangeWaitingPeriodDays)

# The largest squad a season's `max_kader_size` may set, and the first season's own: the edge's link pages are sized for a
# squad this large behind one school's address, so a larger cap would meet the edge's 429 rather than the league's rule.
KADER_SIZE_MAX: Final = 50

# How long an addition, or an administrator's own address change, waits. Each hands out lasting power, so every holder has
# a day to read of it and reach the owner.
type FLGrantWaitHours = Literal[24]
GRANT_WAIT_HOURS: Final[FLGrantWaitHours] = 24

# How long a handover, or the owner's own address change, waits: the owner role is the one nobody else can take back.
type FLOwnerWaitDays = Literal[7]
OWNER_WAIT_DAYS: Final[FLOwnerWaitDays] = 7

GRANT_BOUNDS: Final = (FLGrantWaitHours, FLOwnerWaitDays)

# How long an ended change's record is kept, holding no address, so each link answers what became of it.
type FLAddressChangeRetentionDays = Literal[30]
ADDRESS_CHANGE_RETENTION_DAYS: Final[FLAddressChangeRetentionDays] = 30

# How long a mailbox's document outlives the last press naming it: far past a transaction's life, the one thing it must
# outlast, and a document gone costs the next press an insert, which conflicts as the update does.
type FLMailboxAnchorRetentionHours = Literal[1]
MAILBOX_ANCHOR_RETENTION_HOURS: Final[FLMailboxAnchorRetentionHours] = 1
MAILBOX_ANCHOR_RETENTION_SECONDS: Final = MAILBOX_ANCHOR_RETENTION_HOURS * 60 * 60

# Published as schemas of their own: the privacy notice states each, and the frontend checks its constants against them.
RETENTION_BOUNDS: Final = (FLActionLogRetentionYears, FLAddressChangeRetentionDays, FLMailboxAnchorRetentionHours)

# A row stores the deadline it was given, so raising this moves no request already sent; a fixture
# dated inside it is due the day it is asked.
SPIEL_CONFIRMATION_DEADLINE_DAYS: Final = 7
# How long before its deadline a fixture's parties are first asked about it; a fixture moved after they were asked is
# asked about again at once, however far out.
SPIEL_REQUEST_LEAD_TIME_DAYS: Final = 14
# The one reminder falls this many days before a team row's deadline.
SPIEL_REMINDER_DAYS: Final = 3

# A line-up's three marks, each counted back from its fixture's kick-off, here and nowhere else: from the first a team
# holding none is owed its one reminder, from the second a missing line-up reads overdue, and from the third the team's
# line-up is locked and the administration alone writes it. The first two are days back at the kick-off's clock time in
# Berlin, so a team reads the same hour every week of the year; the lock is real hours.
AUFSTELLUNG_REMINDER_DAYS: Final = 2
AUFSTELLUNG_DUE_DAYS: Final = 1
AUFSTELLUNG_LOCK_HOURS: Final = 1

# Each mark inside the one before it: a lock ahead of the due mark would close a line-up before it is owed, and a
# reminder inside the due mark would remind of one already overdue. A day back across the autumn clock change is 25
# real hours and across the spring one 23, so the lock stays inside the shorter.
if not (AUFSTELLUNG_LOCK_HOURS < 24 * AUFSTELLUNG_DUE_DAYS - 1 and AUFSTELLUNG_DUE_DAYS < AUFSTELLUNG_REMINDER_DAYS):
    raise RuntimeError("A line-up's marks nest: the lock inside the due mark, the due mark inside the reminder's.")

# How many of a line-up start: a side fields eleven. A nominee is named only into the gap below it. Published as a
# schema of its own: the line-up's screen caps its „Startelf“ ticks and disables a nominee's „Aufstellen“ at it.
type FLAufstellungStartersMax = Literal[11]
AUFSTELLUNG_STARTERS_MAX: Final[FLAufstellungStartersMax] = 11

# The age a referee consents at. Its own constant rather than the application contact's, though the
# numbers agree: the two floors are separate judgements, so raising one must not silently raise the
# other.
type FLSchiedsrichterMinAgeYears = Literal[16]
SCHIEDSRICHTER_MIN_AGE_YEARS: Final[FLSchiedsrichterMinAgeYears] = 16

# The age a pupil consents at. Its own constant rather than the referee's or the application
# contact's, though the numbers agree: the floors are separate judgements, so raising one must not
# silently raise another.
type FLRegistrierungMinAgeYears = Literal[16]
REGISTRIERUNG_MIN_AGE_YEARS: Final[FLRegistrierungMinAgeYears] = 16

# One constant for the pupil and the referee, unlike the floors above: the media consent is one
# judgement over every record carrying `media`, and nobody below it is recognisable in a published
# photograph or video, or interviewed.
type FLMediaMinAgeYears = Literal[18]
MEDIA_MIN_AGE_YEARS: Final[FLMediaMinAgeYears] = 18

# Published as schemas of their own: the privacy notice and the consent pages state each figure, and the frontend
# checks its constants against these aliases.
CONSENT_BOUNDS: Final = (
    FLConfirmationDeadlineDays,
    FLBewerbungKontaktMinAgeYears,
    FLSignatoryMinAgeYears,
    FLSchiedsrichterMinAgeYears,
    FLRegistrierungMinAgeYears,
    FLMediaMinAgeYears,
)

# The frontend's administrator cap, NIST SP 800-63B-4 §2.2.3's AAL2 overall timeout:
# the backend refuses an administrator's session whose sign-in is older, as a looser backend honours a
# session the frontend believes gone.
type FLAdminWindowHours = Literal[24]
ADMIN_WINDOW_HOURS: Final[FLAdminWindowHours] = 24

# The frontend ends a person's session this long after its sign-in however recently it was used, and
# the backend refuses a person-lane token whose sign-in is older, lest it honour a session the frontend believes gone.
type FLPersonWindowDays = Literal[30]
PERSON_WINDOW_DAYS: Final[FLPersonWindowDays] = 30

# Published as schemas of their own: the frontend ends its sessions at these figures and the privacy notice states
# them, so a window moved here alone fails the frontend's type check rather than the two tiers ending a session apart.
SESSION_BOUNDS: Final = (FLAdminWindowHours, FLPersonWindowDays)
