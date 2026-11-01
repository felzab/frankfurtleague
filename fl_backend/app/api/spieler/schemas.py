from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter, model_validator

from app.core.crud import Anchored
from app.core.sentinels import GHOST_SPIELER_ID
from app.shared.schemas.bounds import (
    LIST_LIMIT_DEFAULT,
    LIST_LIMIT_MAX,
    SAISON_ID_LENGTH,
)
from app.shared.schemas.custom import CustomDateString, CustomNonEmptyString, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.einwilligung import FLEinwilligungNachweise, FLEinwilligungStand
from app.shared.schemas.kontakt import CustomKontaktName
from app.shared.schemas.literals import (
    FLAddressChangeViewableDenied,
    FLEinwilligungUmfang,
    FLSortOrder,
    FLSpielerPosition,
    FLSpielerStufe,
)
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel

# `[0-9]`, never `\d`: Python's `\d` matches Unicode decimal digits where the frontend mirror's
# does not, and the two ends must accept and refuse the same shirt.
SQUAD_NUMMER_PATTERN = r"^[0-9]{1,4}$"

# Every option is a field the base tier serves: ordering by a key reads it out, whether or not the
# response carries it (`READ-PUPIL-001`, `READ-PUPIL-002`). No admin read takes a sort parameter, so
# there is one Literal.
FLSpielerSortOptions = Literal["vorname", "nummer", "position"]

# Slugs rather than the German `position` and `stufe` store: a role also has a label and a badge
# Kuerzel, and a stored German word would be a third spelling for those two to drift from.
type FLSpielerRolle = Literal["kapitaen", "co_kapitaen"]


class FLEinwilligung(BaseModel):
    """What this person agreed may be published about them.

    Its keys stand TOGETHER, as `FLAustritt`'s do: a scope with no confirmation date claims somebody
    consented, and no surface can tell that from one somebody gave.
    """

    umfang: FLEinwilligungUmfang
    # The day consent was given. A record is born of its person's own confirmation, so it is that day.
    datum: CustomDateString
    # The day its person confirmed it: a record is born confirmed.
    confirmed_at: CustomDateString
    # A label of `fl_backend/app/shared/einwilligung.py :: FASSUNGEN` and never the words, as
    # `app/api/teams/schemas.py :: FLKontaktKenntnisnahme` holds one: a rewording must not change what
    # a stored record claims.
    text_version: str
    # A SECOND consent under one record rather than a third `umfang` member: publication and media
    # are independent answers, so withdrawing one leaves the other standing.
    medien: bool
    # Each choice's evidence (`app/shared/einwilligung_nachweis.py`). Never null: a choice's evidence
    # is set dotted, and MongoDB sets no field under a null.
    nachweis: FLEinwilligungNachweise


class _SpielerPerson(BaseModel):
    """The person's own two fields, shared so no read of a player declares them differently.

    A public read serves an initial for the surname (`READ-PUPIL-001`), or neither name at all
    (`READ-PUPIL-003`) -- a projection's business, and not a declaration's.
    """

    vorname: CustomNonEmptyString
    nachname: str | None


class _SaisonSpielerWritable(BaseModel):
    """The squad-row block every junction payload and echo repeats, beyond the ids and the retirement date each states itself."""

    team_id: CustomObjectId
    nummer: str | None
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    # On the JUNCTION, not the person: a role is held within one team for one season. ONE field
    # rather than a flag per role, because two booleans can both be true.
    rolle: FLSpielerRolle | None


class FLSpielerPublic(_SpielerPerson, BaseReadModel):
    """One squad row as the BASE TIER serves it -- all an anonymous visitor may read.

    `build_spieler_pipeline` withholds the rest: the surname is an initial (`READ-PUPIL-001`), the
    `stufe` is gone (`READ-PUPIL-002`), and the consent record with it.
    """

    # An ALLOW-LIST: every field is one this surface needs. Deriving it by subtracting what looks
    # sensitive puts each later addition to the document on the wire until somebody notices -- which
    # is how a consent record came to be published.

    # No record id (`READ-PUPIL-005`): it outlives every season and team, so it would tie together
    # each squad row of a pupil whose name is withheld. The table keys its rows by their place.

    # Narrowed from `_SpielerPerson`'s non-empty string: the mask answers `null` for a person whose
    # record does not publish them (`READ-PUPIL-003`), and a required forename would 500 the squad
    # list over a withheld row rather than withholding it.
    vorname: str | None

    # Defaulted because an unnarrowed read joins LOOSELY: a person whose every squad row is retired
    # survives the unwind, and `$project` omits a joined key rather than nulling it. Required fields
    # would 500 the list over an ordinary retirement.
    nummer: str | None = None
    position: FLSpielerPosition | None = None


class FLSpielerRecord(_SpielerPerson, Anchored):
    """The person as `spieler` stores it, with none of the squad row's fields."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    # Widened on this stored shape alone, for the erased pupils' sentinel
    # (`app/core/sentinels.py :: GHOST_SPIELER_ID`), and refused on every other row below. Every served
    # model keeps the forename required: no read serves the sentinel, so a null reaching one is that
    # exclusion failing.
    vorname: CustomNonEmptyString | None

    # The day this PERSON left the league. Distinct from the squad row's own `inactive_since`: a
    # player who left one squad has a retired junction row and is still a player.
    inactive_since: CustomOptionalDateString
    # Nullable for `vorname`'s reason: every person carries the date of their own registration.
    geburtsdatum: CustomOptionalDateString
    # No default: a default would let a row with no consent read back as though it had been asked.
    # Nullable for `vorname`'s reason, the sentinel being nobody who could have agreed to anything.
    einwilligung: FLEinwilligung | None
    # Stored as `app/shared/folding.py :: sign_in_identifier` folds it and never as it was typed: the
    # seam joining a signed-in person to this row is an equality on the stored value, and a raw write
    # breaks it silently.
    email: str | None = None
    version: int = 0

    @model_validator(mode="after")
    def _only_the_sentinel_is_nobody(self) -> Self:
        # Every write but the sentinel's stores all three: an admission carries its confirmed
        # registration's name, date and record, and the administrator's edit requires the name and the
        # date. No write gives the sentinel an address, which every address lookup would otherwise find
        # as somebody's pupil. Either state is a hand edit, which the read-back names.
        if self.id == GHOST_SPIELER_ID:
            if self.email is not None:
                raise ValueError("the erased pupils' sentinel holds no address")
        elif any(value is None for value in (self.vorname, self.geburtsdatum, self.einwilligung)):
            raise ValueError("only the erased pupils' sentinel stores no forename, birthdate or consent record")
        return self


class FLSpieler(FLSpielerRecord, _SaisonSpielerWritable):
    """The person as STORED, flattened against one season. A declared shape: NO endpoint returns it.

    `GET /spieler` answers with `FLSpielerPublic` instead.
    """

    is_nachnominiert: bool


FLSpielerListAdapter = TypeAdapter(list[FLSpielerPublic])


class FLSaisonSpielerRow(BaseModel):
    """The junction document as it is STORED -- the DECLARED SHAPE ONLY, validated against no read."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    spieler_id: CustomObjectId
    saison_id: str
    team_id: CustomObjectId
    is_nachnominiert: bool
    rolle: FLSpielerRolle | None
    stufe: FLSpielerStufe | None
    position: FLSpielerPosition | None
    # A STRING, never an int: squad numbers are worn, not counted, and "07" is a printed shirt.
    nummer: str | None
    # The day this SQUAD ROW was retired, which is not the day the person left the league.
    inactive_since: CustomOptionalDateString
    version: int = 0


class FLSaisonSpielerRecord(FLSaisonSpielerRow):
    """A squad row as `saison_spieler` stores it: an admitted registration's submission key and digest, which no read serves."""

    idempotency_key: str | None = None
    idempotency_fingerprint: str | None = None


class FLSpielerFilterParams(BaseModel):
    """What `GET /spieler` may narrow on -- never a field the response withholds.

    A filter on a withheld one rebuilds it from squads of one (`READ-PUPIL-002`), and
    `include_inactive` would un-hide rows this tier serves no marker for (`READ-SQUAD-002`).
    """

    # NOT paths: these narrow which players come back rather than naming one.
    team_id: CustomObjectId | None = None
    saison_id: str | None = None

    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    sort_by: FLSpielerSortOptions = Field(default="position")
    order: FLSortOrder = Field(default="asc")


class FLPatchSpielerPayload(BaseModel):
    """Replaces the person's names WHOLESALE.

    The handler `$set`s this model's dump, so a field with a default would let a form that forgot it
    write that default over a stored value.
    """

    model_config = ConfigDict(extra="forbid")

    vorname: CustomKontaktName
    nachname: CustomKontaktName | None
    # Never null: every person carries the date of their own registration, and a save clearing it
    # would leave one whose age no page can read.
    geburtsdatum: CustomDateString
    # The `version` the editor was served; absent, the save is checked against nothing.
    version: int | None = None


# Private, so the create and the edit state the bound once and the layer publishes no OpenAPI component.
class _SaisonSpielerPayload(_SaisonSpielerWritable):
    # Forbidding extras is also what refuses `is_nachnominiert`: the create derives the marker and
    # nothing edits it, so a caller's value is never stored.
    model_config = ConfigDict(extra="forbid")

    # Tightened on the WRITE side alone: a read model refusing a stored number would answer 500 for
    # the whole list over one row.
    nummer: str | None = Field(pattern=SQUAD_NUMMER_PATTERN)


class FLPostSaisonSpielerPayload(_SaisonSpielerPayload):
    """One player's membership of one team's squad for one season.

    Every field is required, including those a squad often does not know: a caller states `null`
    rather than omitting, so the answer is theirs and not a default nobody chose.
    """

    # The ceiling counts what arrives and the strip runs after it, so the published `maxLength` is what the write accepts.
    saison_id: Annotated[
        str, StringConstraints(max_length=SAISON_ID_LENGTH), AfterValidator(str.strip), StringConstraints(min_length=SAISON_ID_LENGTH)
    ]


class FLPatchSaisonSpielerPayload(_SaisonSpielerPayload):
    """Replaces the squad row WHOLESALE — see `FLPatchSpielerPayload` for why nothing has a default.

    `team_id` is editable here: a mid-season transfer is a change to the junction row.
    """

    # The `version` the editor was served; absent, the save is checked against nothing.
    version: int | None = None


class FLSpielerListResponse(BaseAPIResponse):
    spieler: list[FLSpielerPublic]


class FLSpielerSingleResponse(BaseAPIResponse):
    """One player as the BASE TIER serves them -- an allow-list of what this surface needs.

    Squad fields are season-scoped, and inventing a season would make the answer depend on a default
    nobody stated. `nachname` is an INITIAL here (`READ-PUPIL-001`).
    """

    spieler_id: CustomObjectId
    # Nullable for `FLSpielerPublic.vorname`'s reason: this path is masked by the same predicate
    # (`READ-PUPIL-003`), and the admin echo below re-declares the forename it is served whole.
    vorname: str | None
    nachname: str | None


class FLSpielerAdminSingleResponse(FLSpielerSingleResponse):
    """The same player echoed back to the admin who just wrote them, with their whole name.

    `inactive_since` rides here alone: it IS the answer `DELETE` and `reactivate` give, and no public
    surface renders a pupil's leaving date.
    """

    # Required again where the public read narrowed it: this tier is served no mask, so an echo
    # answering `null` here is the mask having reached the admin editor, and this line fails first.
    vorname: CustomNonEmptyString

    # `app/core/crud.py :: set_inactive_since` is the field's one writer and stamps a German date, so
    # the calendar rule `FLSpieler` states refuses nothing this echo can serve.
    inactive_since: CustomOptionalDateString
    # The writes counted so far, which the editor's save sends back.
    version: int = 0


class FLSaisonSpielerResponse(_SaisonSpielerWritable, BaseAPIResponse):
    """A junction row, which has no read model of its own -- so it is echoed as it was written."""

    spieler_id: CustomObjectId
    saison_id: str
    is_nachnominiert: bool
    # The stored row's own calendar rule, for `FLSpielerAdminSingleResponse.inactive_since`'s reason.
    inactive_since: CustomOptionalDateString
    # The writes counted so far, which the editor's save sends back.
    version: int = 0


class FLSpielerNachnominierungResponse(BaseAPIResponse):
    """Whether an entry into this season's squads today would be marked a Nachnominierung."""

    saison_id: str
    # Named as `FLInvitationViewResponse` names the same verdict, where `running` is the window's.
    nachnominierung: bool


class FLSpielerMembership(_SaisonSpielerWritable, BaseReadModel):
    """One squad row as seen from its player.

    Carries `inactive_since`, which the team junction does not: a player leaves a squad mid-season,
    where a team never leaves a season at all.
    """

    is_nachnominiert: bool

    saison_id: str
    inactive_since: CustomOptionalDateString
    # The writes counted so far, which the editor's save sends back.
    version: int = 0


class FLSpielerWithMemberships(_SpielerPerson, BaseReadModel):
    """The person as stored, plus every squad row they hold.

    A DIFFERENT question from `FLSpieler`, not a projection: that one is FLATTENED against one
    season, so a player in two comes back as two indistinguishable rows.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    # The day the PERSON left the league; a squad row retires independently, on the membership above.
    inactive_since: CustomOptionalDateString
    # Every person carries the date of their own registration, and this read serves no sentinel.
    geburtsdatum: CustomDateString
    # On the PERSON, as `inactive_since` is: consent is given by somebody, not per season. Never null:
    # this read serves no sentinel, and every person is born of their own confirmed registration.
    einwilligung: FLEinwilligung
    # Served here and withheld from the base tier, as the record above is: this read is the admin
    # editor's, and an address is the person's own. Never null: the admission writes one.
    email: str
    # The live change of the pupil's address, which the address tool shows; required, so a read forgetting to look fails
    # rather than hiding a change as none.
    address_change_id: CustomObjectId | None
    # The writes counted so far, which the editor's save sends back.
    version: int = 0
    # Why the address tool refuses that change this administrator; null where it opens it or none stands.
    address_change_viewable_denied: FLAddressChangeViewableDenied | None
    memberships: list[FLSpielerMembership]


class FLSpielerSaisonsResponse(BaseAPIResponse):
    """Every player, retired ones included, each with their squad rows. Sorted by name."""

    spieler: list[FLSpielerWithMemberships]


class FLKaderRow(BaseAPIResponse):
    """One squad row as its team's seat holder reads it (`READ-KADER-001`).

    Declared from nothing rather than a public model unmasked, so the whole surname reaches no
    base-tier model, and no address or telephone number reaches this one.
    """

    spieler_id: CustomObjectId
    vorname: CustomNonEmptyString
    # Whole: the initial protects a pupil from strangers, never from their own team's representative.
    nachname: str | None
    # As stored, for `FLSaisonSpielerRow.nummer`'s reason: a read refusing a hand-edited number would
    # answer 500 for the whole squad.
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
    # What the editor may offer, the PATCH refusing anything else it was not already holding (`kader_stufe_not_allowed`).
    # The floor `app/api/saisons/schemas.py :: FLSaisonRules.erlaubte_stufen` writes, so the document
    # publishes what the season guarantees.
    allowed_stufen: list[FLSpielerStufe] = Field(min_length=1)
    kader: list[FLKaderRow]


class FLPatchKaderRowPayload(BaseModel):
    """What a team's seat holder may change on a live squad row, WHOLESALE for `FLPatchSpielerPayload`'s reason.

    Never `_SaisonSpielerPayload`'s child, which carries `team_id`: a representative moves no pupil
    to another team, and `extra="forbid"` refuses that key.
    """

    model_config = ConfigDict(extra="forbid")

    # Tightened on the write side alone, as `_SaisonSpielerPayload.nummer` is.
    nummer: str | None = Field(pattern=SQUAD_NUMMER_PATTERN)
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    rolle: FLSpielerRolle | None
    # The `version` the editor was served; absent, the save is checked against nothing.
    version: int | None = None


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


class FLSpielerContext(BaseModel):
    """What the pupil confirmation page's slots name for this record today, so its agreed words render whole.

    Null where no squad row names a team and season; the words then render without them.
    """

    team: str | None
    schule: str | None
    saison: str | None


class FLSpielerSelf(_SpielerPerson):
    """One pupil record's stored data as its own person reads it: the whole surname and the birthdate, never masked.

    Its consent is the account page's, whose entry extends this (`app/api/konto/schemas.py :: FLAccountSpielerEinwilligung`).
    """

    spieler_id: CustomObjectId
    geburtsdatum: CustomDateString
    kader: list[FLSpielerSelfKaderRow]


class FLSpielerSelfResponse(BaseAPIResponse):
    """The signed-in address's own pupil record: one at most, `spieler.email` being unique."""

    spieler: FLSpielerSelf


class FLSpielerAccountEinwilligungResponse(BaseAPIResponse):
    """The record as it stands after the write, everything the person did not move unchanged."""

    spieler_id: CustomObjectId
    einwilligung: FLEinwilligung
    # The precondition a next press on this page echoes.
    nachweis_stand: FLEinwilligungStand
