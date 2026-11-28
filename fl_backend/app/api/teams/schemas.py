from collections.abc import Mapping
from typing import Annotated, Final, Literal, get_args

from pydantic import (
    AfterValidator,
    BaseModel,
    Field,
    StringConstraints,
    TypeAdapter,
)

from app.api.outbox.schemas import FLOutboxStatus
from app.core.crud import Anchored
from app.shared.schemas.addresses import FLAddress, FLAddressPayload
from app.shared.schemas.bounds import TEAM_FULL_NAME_MAX_LENGTH, TEAM_NAME_MAX_LENGTH
from app.shared.schemas.custom import (
    PARAGRAPH_PATTERN,
    PHONE_REGEX,
    SINGLE_LINE_PATTERN,
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
    CustomOptionalExternalUrl,
    CustomOptionalWebsiteUrl,
    CustomShorthand,
    CustomVersion,
)
from app.shared.schemas.einwilligung import (
    FLEinwilligungEvidenceSet,
    FLSeatTextVersions,
    cite_their_kind,
)
from app.shared.schemas.kontakt import CustomEmail, CustomKontaktName, CustomStoredAddress
from app.shared.schemas.literals import (
    FLAustrittType,
    FLGruppenNames,
    FLKontaktKenntnisnahmeScope,
    FLKontaktSeat,
    FLSaisonStatus,
    FLSchulform,
    FLTrikotFarbe,
)
from app.shared.schemas.responses import BasePayload, BaseReadModel

# Read off the closed set rather than chosen beside it: a cap over the set size is one
# `offered_gruppen` serves short while refusing nothing.
MAX_NUMBER_OF_GROUPS: Final = len(get_args(FLGruppenNames.__value__))

# Which second seat one person may hold beside the Trainer's. A closed set rather than a flag per seat: the
# two are alternatives, and nothing can mean holding both.
type FLTrainerAlso = Literal["ansprechperson", "stellvertretung"]

TEAM_DESCRIPTION_MAX_LENGTH: Final = 4096

# Why a team is out of a season, in an administrator's words on the team's public page: a sentence, as a
# ban's reason is.
AUSTRITT_REASON_MAX_LENGTH: Final = 500


class FLAustritt(BaseModel):
    """How a team came to be out of one season, why, and from when.

    `reason` is free text and public -- it appears on the team's page, and this league publishes no
    disciplinary code an enum could cite.
    """

    type: FLAustrittType
    # A name written here outlives an erasure, which rewrites structured fields alone.
    reason: CustomNonEmptyString
    # The day the exit took effect, not the day somebody typed it in.
    date: CustomDateString


class FLAustrittPayload(FLAustritt, BasePayload):
    """The exit as an administrator writes it: the reason ceilinged as it arrives and stripped before its floor.

    On the write side alone, so a read model takes a stored blank or a longer reason as it stands.
    """

    reason: Annotated[
        str,
        StringConstraints(max_length=AUSTRITT_REASON_MAX_LENGTH, pattern=PARAGRAPH_PATTERN),
        AfterValidator(str.strip),
        StringConstraints(min_length=1),
    ]


class FLKontaktKenntnisnahme(BaseReadModel):
    """The scope this person's record is held on, the day they were seated, and what they answered.

    Kenntnisnahme and not Einwilligung: the published basis is Art. 6(1)(f), the optional WhatsApp scope and the media
    answer alone being consents under Art. 6(1)(a), and a pupil's consent record holds other values entirely.
    """

    scope: FLKontaktKenntnisnahmeScope
    date: CustomDateString
    # The day this person confirmed the seat themselves; null until they do.
    confirmed_at: CustomOptionalDateString
    # The one consent on this record, to photographs, video and interviews.
    media: bool
    # Each choice's evidence, empty until the seat's person answers and never null: a choice's evidence is set dotted,
    # and MongoDB sets no field under a null. A seat's wordings alone.
    evidence: Annotated[FLEinwilligungEvidenceSet, AfterValidator(lambda evidence_set: cite_their_kind(evidence_set, FLSeatTextVersions))] = (
        Field(default_factory=FLEinwilligungEvidenceSet)
    )


class FLKontaktperson(BaseModel):
    """One person the league reaches this team through, for one season."""

    first_name: CustomNonEmptyString
    last_name: CustomNonEmptyString
    email: str
    # The league's whole channel to a team is this number. Whether it may be reached on WhatsApp
    # rests on the optional consent the person gives on their own confirmation page, never on the
    # form's wording.
    phone: str
    # Null until the person types it on their own confirmation page, so the public form never asks
    # for it.
    birth_date: CustomOptionalDateString
    einwilligung: FLKontaktKenntnisnahme


class FLSaisonTeamKontakte(BaseModel):
    """The three people a team is reached through, for one season.

    On the junction rather than the club: a school's staff turns over between seasons, and a
    finished season keeps those who confirmed their seat.
    """

    # Nullable per seat: a person's erasure empties the seats naming them and must not reach the
    # two people beside them.
    trainer: FLKontaktperson | None
    ansprechperson: FLKontaktperson | None
    stellvertretung: FLKontaktperson | None
    # Which other seat the Trainer also holds, or nobody. One nullable field rather than two flags,
    # which would let a row claim both at once. Stored rather than derived: two people can share
    # every field, and an assertion is not a coincidence.
    trainer_is_also: FLTrainerAlso | None


class FLKontaktpersonRecord(FLKontaktperson):
    """One seat's person as a season row and an application store them, the address in the fold every seat lookup compares."""

    email: CustomStoredAddress


class FLSaisonTeamKontakteRecord(FLSaisonTeamKontakte):
    """The three seats as stored, for the record models alone.

    A page's read keeps the plain address, so one stray row is named by the read-back rather than refusing the whole
    list it stands in.
    """

    trainer: FLKontaktpersonRecord | None
    ansprechperson: FLKontaktpersonRecord | None
    stellvertretung: FLKontaktpersonRecord | None


# No `token_hashes`: the raw document key the link's lookup alone reads.
class FLSaisonTeamConfirmation(BaseModel):
    """One seat's confirmation link as the season row stores it."""

    sent_at: CustomDateString
    # Stored rather than derived from `sent_at` and the bound: raising the bound would otherwise
    # move the deadline of every link already in somebody's inbox.
    deadline: CustomDateString
    # Beside the seat rather than inside it: a Widerspruch empties the seat, and a marker in there would go with it.
    declined_at: CustomOptionalDateString


class FLSaisonTeamConfirmations(BaseModel):
    """The three seats' links, outside `kontakte` and mirroring its seats; nullable per seat, as the person beside each is."""

    trainer: FLSaisonTeamConfirmation | None
    ansprechperson: FLSaisonTeamConfirmation | None
    stellvertretung: FLSaisonTeamConfirmation | None


class FLSaisonTeamConfirmationRecord(FLSaisonTeamConfirmation):
    """One seat's link as the season row stores it, with the hash of the link the last hand-out of its mail minted.

    Empty from the write owing the mail until its hand-out, so the link the seat held before opens nothing from the write on.
    """

    token_hashes: list[str]


class FLSaisonTeamConfirmationsRecord(FLSaisonTeamConfirmations):
    trainer: FLSaisonTeamConfirmationRecord | None
    ansprechperson: FLSaisonTeamConfirmationRecord | None
    stellvertretung: FLSaisonTeamConfirmationRecord | None


class FLSaisonTeamRecord(Anchored):
    """One club's season as `saison_teams` stores it; no read serves the row whole."""

    id: CustomObjectId = Field(validation_alias="_id")
    saison_id: str
    team_id: CustomObjectId
    gruppe: FLGruppenNames
    austritt: FLAustritt | None
    trikot_farbe: FLTrikotFarbe | None
    kontakte: FLSaisonTeamKontakteRecord | None
    confirmations: FLSaisonTeamConfirmationsRecord | None = None
    name: str
    shorthand: str
    version: int


class FLSaisonTeamConfirmationView(FLSaisonTeamConfirmation, BaseReadModel):
    """One seat's link as the contacts editor reads it: the stored link and whether it has lapsed."""

    # Judged on the read by the rule the seat's press refuses on, at the server's date, so no client
    # compares `deadline` to a clock of its own; a read model, since nothing stores it.
    expired: bool
    # What became of the last mail carrying this seat's link, off the Postausgang; null where none was ever owed.
    # Required, so a read that forgot to compose it fails rather than answering every link as one nobody was sent.
    delivery: FLOutboxStatus | None


class FLSaisonTeamConfirmationsView(BaseModel):
    trainer: FLSaisonTeamConfirmationView | None
    ansprechperson: FLSaisonTeamConfirmationView | None
    stellvertretung: FLSaisonTeamConfirmationView | None


# Private, so it publishes no OpenAPI component, and a base rather than `FLKontaktperson` itself because
# Pydantic cannot un-inherit a field: no payload takes a birthdate, the date being the person's own
# to enter at their confirmation, and no payload takes a consent record, which the server composes.
# The ceilings are here and not on the read models above: refusing a stored value on read answers 500
# for a whole list over one row, and locks out the write that would repair it.
class _KontaktpersonWritablePayload(BasePayload):
    # Tightened on the write side alone, in the type the public
    # application and a referee's name take too, so the editor and the form refuse a name alike.
    first_name: CustomKontaktName
    last_name: CustomKontaktName
    email: CustomEmail
    # Here rather than beside the format: the pattern caps the length inside itself, which makes it
    # a ceiling.
    phone: str = Field(pattern=PHONE_REGEX)


class FLTeamStatistik(BaseReadModel):
    # `default=` by keyword, never `Field(0, ge=0)`: a positional one leaves the field looking
    # required to Pyright while ruff and the tests stay silent.
    count_played_spiele: int = Field(default=0, ge=0)
    siege: int = Field(default=0, ge=0)
    niederlagen: int = Field(default=0, ge=0)
    unentschieden: int = Field(default=0, ge=0)
    tore_scored: int = Field(default=0, ge=0)
    tore_conceded: int = Field(default=0, ge=0)
    punkte: int = Field(default=0, ge=0)
    # Beside the scoring, never inside it: the fixtures that ended with no result,
    # called off or struck out. A forfeit is in `count_played_spiele` alone, its
    # awarded result being one the table counts.
    count_cancelled_spiele: int = Field(default=0, ge=0)


# Private, so the payloads, the stored record and the read model state these fields once, and the
# base itself publishes no OpenAPI component.
class _TeamWritable(BaseModel):
    name: CustomNonEmptyString
    shorthand: CustomShorthand
    # Capped so the public page and the editor's textarea agree on what fits.
    description: str = Field(max_length=TEAM_DESCRIPTION_MAX_LENGTH)
    full_name: CustomNonEmptyString
    # No default here, so the payloads inherit none: `PATCH` replaces the club wholesale, and an
    # omitted key would clear a school form and fan the clearing out as an edit somebody asked for.
    schulform: FLSchulform | None
    # Rendered straight into an href on a public page, so the scheme is constrained here, on every read as on every
    # write. Null where a school has no site: `""` renders as a link to the page it sits on.
    website_url: CustomOptionalExternalUrl
    # Public on every read, a data-protection expert consulted: a school's street stays on the base
    # tier, and the application form asking for it says so.
    address: FLAddress


class FLTeam(_TeamWritable):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    gruppe: FLGruppenNames
    statistik: FLTeamStatistik
    # Joined from the junction on every read, and copied into no match document.
    austritt: FLAustritt | None
    # The day this club left the league. Leaving one season is `austritt` above.
    inactive_since: CustomOptionalDateString


FLTeamListAdapter = TypeAdapter(list[FLTeam])


class FLTeamRecord(_TeamWritable, BaseReadModel, Anchored):
    """The club document as it is stored."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    inactive_since: CustomOptionalDateString
    version: int


class FLGruppenTeam(BaseModel):
    """One row of a league table: what a standing shows and nothing more.

    Narrower than `FLTeam` on purpose: a public client component renders this, so every field is
    serialised into the page, and a club's address is a school's street.
    """

    id: CustomObjectId
    name: CustomNonEmptyString
    shorthand: CustomShorthand
    statistik: FLTeamStatistik
    # The type alone: a row marks that a club is out, and the club's own page publishes the reason
    # and the date.
    austritt_type: FLAustrittType | None


class FLTabelleRow(FLGruppenTeam):
    """One row of the Tabelle: the standing row and its placing, null for a club with no match or gone before its group was decided."""

    platz: int | None = Field(gt=0)


# Every group the season offers in standing order, the clubs that have played no match last. Each club that has played
# and stood in the season on the day its group was decided is numbered as a `Platz` is, and clubs the chain leaves level
# share one.
type FLTabelle = Mapping[FLGruppenNames, list[FLTabelleRow]]


class FLTabelleResponse(BaseReadModel):
    """One season's Tabelle: each group's standing over the group phase, and how many of each group advance."""

    gruppen: FLTabelle
    qualifiers_per_gruppe: int = Field(gt=0)


class FLSaisonTeamEntry(BaseReadModel):
    """One club of a season as the Teams page lists it: the name and shorthand it plays this season under."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    name: CustomNonEmptyString
    shorthand: CustomShorthand
    gruppe: FLGruppenNames
    # The type alone, as a standing row carries it: the club's own page publishes the reason and the date.
    austritt_type: FLAustrittType | None


FLSaisonTeamEntryListAdapter = TypeAdapter(list[FLSaisonTeamEntry])


class FLSaisonTeamsResponse(BaseReadModel):
    """A season's clubs, by name."""

    teams: list[FLSaisonTeamEntry]


class FLTeamPageTeam(_TeamWritable, BaseReadModel):
    """The club as its page in one season shows it: the school, its group, and how it left the season if it did.

    The whole `austritt` record, reason and day: this page is the one that publishes them.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    gruppe: FLGruppenNames
    austritt: FLAustritt | None


class FLKontaktKenntnisnahmeAdmin(BaseReadModel):
    """What a seat's person answered, as the team editor reads it: the day they confirmed and their two choices, never the evidence."""

    scope: FLKontaktKenntnisnahmeScope
    # Null until the person confirms the seat themselves.
    confirmed_at: CustomOptionalDateString
    media: bool


class FLKontaktpersonAdmin(BaseReadModel):
    """One seat's person as the team editor reads them.

    No birthdate: it is asked once for the age check, and no page of the administration shows it. Declared apart from
    the stored seat rather than derived from it, since what a page reads and what the league keeps change for different
    reasons.
    """

    first_name: CustomNonEmptyString
    last_name: CustomNonEmptyString
    email: str
    phone: str
    einwilligung: FLKontaktKenntnisnahmeAdmin


class FLSaisonTeamKontakteAdmin(BaseReadModel):
    """The three seats as the team editor reads them, nullable per seat as stored."""

    trainer: FLKontaktpersonAdmin | None
    ansprechperson: FLKontaktpersonAdmin | None
    stellvertretung: FLKontaktpersonAdmin | None
    trainer_is_also: FLTrainerAlso | None


class FLTeamMembership(BaseReadModel):
    """One junction row as seen from its club: which season, which group, and the record if any."""

    saison_id: str
    gruppe: FLGruppenNames
    austritt: FLAustritt | None
    trikot_farbe: FLTrikotFarbe | None
    kontakte: FLSaisonTeamKontakteAdmin | None
    # Each seat's link as the editor shows it. Defaulted: `$project` omits a
    # key the stored row has not got, and a row holds none until a save mints its first link.
    confirmations: FLSaisonTeamConfirmationsView | None = None
    # The row's count of writes, which its two editors' saves send back.
    version: int


# Private, so it publishes no OpenAPI component. The bounded address sits here rather than on that base,
# which `FLTeam` and `FLTeamRecord` share.
class _TeamPayload(_TeamWritable, BasePayload):
    address: FLAddressPayload
    # Stripped and ceilinged on the write side alone, so a stored value reads as it stands;
    # `name` reaches a league table row, where a space would show. The ceiling counts what arrives and
    # the strip runs after it, so the published `maxLength` is what the backend accepts.
    name: Annotated[
        str,
        StringConstraints(max_length=TEAM_NAME_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN),
        AfterValidator(str.strip),
        StringConstraints(min_length=1),
    ]
    full_name: Annotated[
        str,
        StringConstraints(max_length=TEAM_FULL_NAME_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN),
        AfterValidator(str.strip),
        StringConstraints(min_length=1),
    ]
    shorthand: CustomShorthand
    website_url: CustomOptionalWebsiteUrl


class FLPostTeamPayload(_TeamPayload):
    pass


class FLPatchTeamSaisonPayload(_TeamPayload):
    """The team editor's one save: the club, and its colour and group in the season the page stands under.

    Replaced wholesale, with no seat and no `austritt`: a seat is its own write's, and an exit is a write of its own,
    which owes mail.
    """

    gruppe: FLGruppenNames
    trikot_farbe: FLTrikotFarbe | None
    # `FLTeamSaisonAdminResponse.version` as the editor read it.
    version: CustomVersion


class FLEntryKnownTeam(BasePayload):
    """A club the league holds, picked from the list's create dialog."""

    kind: Literal["known"]
    team_id: CustomObjectId


class FLEntryNewTeam(BasePayload):
    """A club the entry founds, in the transaction that enters it."""

    kind: Literal["new"]
    team: FLPostTeamPayload


class FLPostTeamEntryPayload(BasePayload):
    """One club's entry into a season, the club known or new. One field rather than two nullable ones, so no body names both."""

    team: Annotated[FLEntryKnownTeam | FLEntryNewTeam, Field(discriminator="kind")]
    gruppe: FLGruppenNames
    trikot_farbe: FLTrikotFarbe | None


class FLReplaceSaisonTeamPayload(BasePayload):
    """Which club takes this season's row over. The path names the club going out."""

    # The only field: the row keeps the group it stands in, and its copy of the identity is reseeded
    # from the incoming club, so a client-supplied name could only disagree with it.
    incoming_team_id: CustomObjectId


class FLKontaktSeatPayload(_KontaktpersonWritablePayload):
    """The person one seat is to hold, on the row's `version` the dialog read, who has agreed to nothing yet."""

    # The Trainer's own claim, so read on their seat alone: sent there, it replaces the stored one, null ending it, and
    # left out it stands, so a dialog offering no choice claims nothing.
    trainer_is_also: FLTrainerAlso | None = None
    version: CustomVersion


# The list's status filter: in the season, out of it, or out of the league.
type FLTeamListState = Literal["active", "departed", "retired"]


class FLTeamsAdminFilterParams(BaseModel):
    """What the Teams list narrows on, each filter held in the page's address."""

    saison_id: str
    gruppe: FLGruppenNames | None = None
    state: FLTeamListState | None = None


class FLTeamsAdminRow(BaseReadModel):
    """One club as the Teams list shows it: the name it plays this season under, or today's for a club holding no row of it."""

    id: CustomObjectId
    name: str
    shorthand: str
    gruppe: FLGruppenNames | None
    trikot_farbe: FLTrikotFarbe | None
    # The type alone, as a standing row carries it.
    austritt_type: FLAustrittType | None
    inactive_since: CustomOptionalDateString


class FLTeamGruppeOffer(BaseReadModel):
    """One group a season offers, closed where it is full."""

    gruppe: FLGruppenNames
    full: bool


class FLTeamEntryTeam(BaseReadModel):
    """A club the entry's picker offers: one still in the league that holds no row of the season."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    name: str


class FLTeamEntryOffer(BaseReadModel):
    """What the list's create dialog offers, and why the entry would be refused now."""

    teams: list[FLTeamEntryTeam]
    gruppen: list[FLTeamGruppeOffer]
    # Only a `future` season takes an entry; every other refusal is about the group or the club the dialog picks.
    closed: bool
    # The colours a row of the season holds, which no entry may take.
    taken: list[FLTrikotFarbe]


class FLTeamsAdminListResponse(BaseReadModel):
    """One season's Teams list, and what its create dialog offers."""

    teams: list[FLTeamsAdminRow]
    entry: FLTeamEntryOffer


class FLTeamSaisonFacts(BaseReadModel):
    """The season a team editor stands under, as far as the editor's locks read it."""

    id: str
    status: FLSaisonStatus
    start_date: CustomDateString
    # Whether the season has started, which an exit is refused before.
    begun: bool
    # The registration window's end, past which an entry through the link is a nominee, the link opening on until the
    # season ends; null for a season storing no window.
    registrierung_end: CustomOptionalDateString


class FLKontaktMint(BaseModel):
    """One person a write owed a fresh confirmation link, which the Postausgang mails: never the link itself."""

    # Every seat the one link answers for, two where the Trainer holds a second: one link per person.
    seats: list[FLKontaktSeat]
    # As this transaction stored it, never a caller's earlier read: the address the mail is owed to.
    email: str


class FLKontaktSeatResponse(BaseReadModel):
    """Where the seat write's link went."""

    # The address the fresh link is owed to, as stored. Null where the seat keeps its person, who keeps their link.
    email: str | None


class FLTeamSeat(BaseModel):
    """One person on the team's seats as the people beside them see it: who, which seats, and whether they answered their link.

    A Trainer holding a second seat is one entry naming both, and no address, telephone number or birthdate is served,
    only administrators seeing those.
    """

    # The seats the entry's person holds: the Trainer's first, and the seat `trainer_is_also` names beside it.
    seats: list[FLKontaktSeat]
    # Null for an empty seat, which is answered rather than omitted: a missing line reads as a team
    # with two seats rather than one with a seat unfilled.
    name: str | None
    # Composed from the stamp and never the stamp itself, so no date about another person crosses.
    confirmed: bool
