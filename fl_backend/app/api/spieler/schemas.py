from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

from app.core.crud import Anchored
from app.shared.schemas.custom import CustomDateString, CustomNonEmptyString, CustomObjectId, CustomOptionalDateString, CustomVersion
from app.shared.schemas.einwilligung import FLEinwilligungEvidenceSet, FLSpielerTextVersions, cite_their_kind
from app.shared.schemas.kontakt import CustomKontaktName, CustomStoredAddress
from app.shared.schemas.literals import (
    FLEinwilligungScope,
    FLSpielerPosition,
    FLSpielerStufe,
)
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel

# `[0-9]`, never `\d`: Python's `\d` matches Unicode decimal digits where the frontend mirror's
# does not, and the two ends must accept and refuse the same shirt.
SQUAD_NUMMER_PATTERN = r"^[0-9]{1,4}$"

# Slugs rather than the German `position` and `stufe` store: a role also has a label and a badge
# Kuerzel, and a stored German word would be a third spelling for those two to drift from.
type FLSpielerRolle = Literal["kapitaen", "co_kapitaen"]


class FLEinwilligung(BaseModel):
    """What this person agreed may be published about them.

    Its keys stand together: a scope with no confirmation date claims somebody consented, and no surface can tell
    that from one somebody gave.
    """

    scope: FLEinwilligungScope
    # The day consent was given. A record is born of its person's own confirmation, so it is that day.
    date: CustomDateString
    # The day its person confirmed it: a record is born confirmed.
    confirmed_at: CustomDateString
    # A second consent under one record rather than a third `scope` member: publication and media
    # are independent answers, so withdrawing one leaves the other standing.
    media: bool
    # Each choice's evidence. Never null: a choice's evidence is set dotted, and MongoDB sets no field
    # under a null.
    evidence: FLEinwilligungEvidenceSet


class _SpielerPerson(BaseModel):
    """The person's own two fields, shared so no read of a player declares them differently.

    A public read serves an initial for the surname, or neither name where the consent withholds them -- a
    projection's business, and not a declaration's.
    """

    first_name: CustomNonEmptyString
    last_name: str | None


class _SaisonSpielerWritable(BaseModel):
    """The squad-row block every junction echo repeats, beyond the ids and the retirement date each states itself."""

    team_id: CustomObjectId
    nummer: str | None
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    # On the junction, not the person: a role is held within one team for one season. One field
    # rather than a flag per role, because two booleans can both be true.
    rolle: FLSpielerRolle | None


class FLSpielerPublic(_SpielerPerson, BaseReadModel):
    """One squad row as an anonymous visitor may read it: the surname an initial, and no `stufe` or consent record."""

    # An allow-list: every field is one this surface needs. Deriving it by subtracting what looks
    # sensitive puts each later addition to the document on the wire until somebody notices.

    # No record id: it outlives every season and team, so it would tie together each squad row of a
    # pupil whose name is withheld. The table keys its rows by their place.

    # Narrowed from `_SpielerPerson`'s non-empty string: the mask answers `null` for a person whose
    # record does not publish them, and a required forename would 500 the squad list over a withheld
    # row rather than withholding it.
    first_name: str | None

    # Defaulted because an unnarrowed read joins loosely: a person whose every squad row is retired
    # survives the unwind, and `$project` omits a joined key rather than nulling it. Required fields
    # would 500 the list over an ordinary retirement.
    nummer: str | None = None
    position: FLSpielerPosition | None = None
    # The captaincy the squad row holds, for the mark beside the name: null wherever the name is withheld, beside which
    # it would say who the nameless pupil is. Defaulted for the same loose join.
    rolle: FLSpielerRolle | None = None


class FLSpielerRecord(_SpielerPerson, Anchored):
    """The person as `spieler` stores it, with none of the squad row's fields."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    # Every person carries the date of their own registration: an admission writes it, and the administrator's edit
    # requires it.
    birth_date: CustomDateString
    # No default: a default would let a row with no consent read back as though it had been asked.
    einwilligung: FLEinwilligung
    # Stored folded, as the sign-in folds it, and never as it was typed: the seam joining a signed-in
    # person to this row is an equality on the stored value, so a raw write breaks it, which the
    # read-back names. Required: every erasure finds a person by address, so a person holding none
    # would be out of every erasure's reach.
    email: CustomStoredAddress
    version: int = 0

    @model_validator(mode="after")
    def _cites_a_pupils_wordings(self) -> Self:
        cite_their_kind(self.einwilligung.evidence, FLSpielerTextVersions)
        return self


FLSpielerListAdapter = TypeAdapter(list[FLSpielerPublic])


class FLSaisonSpielerRow(BaseModel):
    """The junction document as it is stored: the declared shape only, validated against no read."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    spieler_id: CustomObjectId
    saison_id: str
    team_id: CustomObjectId
    is_nachnominiert: bool
    rolle: FLSpielerRolle | None
    stufe: FLSpielerStufe | None
    position: FLSpielerPosition | None
    # A string, never an int: squad numbers are worn, not counted, and "07" is a printed shirt.
    nummer: str | None
    # The day this squad row was retired, which is not the day the person left the league.
    inactive_since: CustomOptionalDateString
    version: int = 0


class FLSpielerSingleResponse(BaseAPIResponse):
    """One player as an anonymous visitor may read them, the surname an initial and no squad field of any season."""

    spieler_id: CustomObjectId
    # Nullable: this path is masked by the squad list's predicate, which answers `null` for a person
    # whose record does not publish them.
    first_name: str | None
    last_name: str | None


class FLSpielerAdminRow(BaseReadModel):
    """One squad row as the Spieler list shows it: the person's name and nothing else of them."""

    spieler_id: CustomObjectId
    first_name: CustomNonEmptyString
    last_name: str | None
    team_id: CustomObjectId
    # The name the club plays the season under; null for a row whose club no longer stands in the season, a replacement
    # having taken it out.
    team_name: str | None
    nummer: str | None
    stufe: FLSpielerStufe | None
    is_nachnominiert: bool
    inactive_since: CustomOptionalDateString
    # Judged within the row's own squad: two clubs' number 7 are two shirts.
    nummer_double: bool


class FLSpielerAdminListResponse(BaseAPIResponse):
    """One season's squad rows, every team's, live and ausgetragen alike, sorted by name."""

    spieler: list[FLSpielerAdminRow]


class FLSpielerSaisonPerson(_SpielerPerson, BaseReadModel):
    """The person as the editor shows them: their own record, which outlives the season."""

    birth_date: CustomDateString
    # Read-only here: only the person's own writes grant it.
    einwilligung: FLEinwilligung
    email: str


class FLSpielerSaisonKader(_SaisonSpielerWritable, BaseReadModel):
    """The squad row the editor stands on, with the name its club plays the season under."""

    team_name: str | None
    is_nachnominiert: bool
    inactive_since: CustomOptionalDateString


class FLSpielerSaisonAdminResponse(BaseAPIResponse):
    """What the Spieler editor shows in one read: the person, their row of the season, and what its boxes may offer."""

    # The one count this page saves on, its two documents' added.
    version: int = Field(ge=0)
    person: FLSpielerSaisonPerson
    kader: FLSpielerSaisonKader
    # What the Stufe box may offer, beside a value the row already holds (`kader_stufe_not_allowed`).
    allowed_stufen: list[FLSpielerStufe] = Field(min_length=1)
    # The roles another live row of the squad holds (`kader_rolle_taken`).
    taken_rollen: list[FLSpielerRolle]


class FLPatchSpielerSaisonResponse(BaseAPIResponse):
    """The count the editor's next save sends."""

    version: int = Field(ge=0)


class FLKaderRow(BaseAPIResponse):
    """One squad row as its team's seat holder reads it, the surname whole and no address or telephone number."""

    # Declared from nothing rather than a public model unmasked, so the whole surname reaches no
    # base-tier model, and no address or telephone number reaches this one.
    spieler_id: CustomObjectId
    first_name: CustomNonEmptyString
    # Whole: the initial protects a pupil from strangers, never from their own team's representative.
    last_name: str | None
    # As stored: a read refusing a hand-edited number would answer 500 for the whole squad.
    nummer: str | None
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    rolle: FLSpielerRolle | None
    is_nachnominiert: bool
    # Set, the row is ausgetragen and read-only to a representative: only the administrator brings it back.
    inactive_since: CustomOptionalDateString
    # Composed on read and stored nowhere, so it cannot go stale beside the rows it compares.
    nummer_double: bool
    # The writes counted so far, which the editor's save sends back.
    version: int = 0


class FLKaderResponse(BaseAPIResponse):
    """A team's squad for one season, live and ausgetragen rows alike, with the Stufen the season's rules offer."""

    team_id: CustomObjectId
    saison_id: str
    # What the editor may offer, the save refusing anything else a row was not already holding. At
    # least one, as the season's rules guarantee, so the document publishes what the season holds.
    allowed_stufen: list[FLSpielerStufe] = Field(min_length=1)
    kader: list[FLKaderRow]


class _KaderRowFields(BaseModel):
    """What an edit may change on a squad row, wholesale.

    The handler `$set`s these, so a field with a default would let a form that forgot it write that default over a
    stored value. No player moves between teams, so `extra="forbid"` refuses `team_id`; it is also what refuses
    `is_nachnominiert`, which no edit sets or clears.
    """

    model_config = ConfigDict(extra="forbid")

    # Tightened on the write side alone: a read model refusing a stored number would answer 500 for
    # the whole list over one row.
    nummer: str | None = Field(pattern=SQUAD_NUMMER_PATTERN)
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    rolle: FLSpielerRolle | None


class FLPatchKaderRowPayload(_KaderRowFields):
    """A seat holder's edit of a squad row."""

    version: CustomVersion


class FLPatchSpielerSaisonPayload(_KaderRowFields):
    """The Spieler editor's one save: the person, and their squad row in the season the page stands under.

    Replaced wholesale, with no consent and no address, each being the person's own to change.
    """

    first_name: CustomKontaktName
    last_name: CustomKontaktName | None
    # Never null: every person carries the date of their own registration, and a save clearing it
    # would leave one whose age no page can read.
    birth_date: CustomDateString
    # `FLSpielerSaisonAdminResponse.version` as the editor read it.
    version: CustomVersion


class FLSpielerSelfKaderRow(BaseModel):
    """One squad row as its own pupil reads it, with the name the club played that season under."""

    team_id: CustomObjectId
    # The season row's own name and never the club's current one: a
    # squad left two seasons ago is listed as it was played.
    team_name: str
    saison_id: str
    nummer: str | None
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    rolle: FLSpielerRolle | None
    is_nachnominiert: bool
    inactive_since: CustomOptionalDateString


class FLSpielerSelfPerson(_SpielerPerson):
    """One pupil record's stored data as its own person reads it: the whole surname and the birthdate, never masked.

    Its consent is the account page's.
    """

    spieler_id: CustomObjectId
    birth_date: CustomDateString
