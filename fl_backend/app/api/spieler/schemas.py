from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, SAISON_ID_LENGTH
from app.shared.schemas.custom import PERSON_NAME_PATTERN, CustomNonEmptyString, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.responses import BaseAPIResponse

# `[0-9]`, never `\d`: Python's `\d` matches Unicode decimal digits where the frontend mirror's
# does not, and the two ends must accept and refuse the same shirt.
SQUAD_NUMMER_PATTERN = r"^[0-9]{1,4}$"

# Every option is a field the base tier serves: ordering by a key reads it out, whether or not the
# response carries it (`READ-PUPIL-001`, `READ-PUPIL-002`). No admin read takes a sort parameter, so
# there is one Literal.
FLSpielerSortOptions = Literal["vorname", "nummer", "position"]

# In the order a squad sheet lists them. `sort_by="position"` sorts the STRING, so a public squad
# list is alphabetical instead.
FLSpielerPosition = Literal["Tor", "Abwehr", "Mittelfeld", "Angriff"]

# The Hessen Oberstufe, both phases. E2 is offered although no row holds it: a set stopping at what
# a season contains would refuse an entry as the year turns.
FLSpielerStufe = Literal["E1", "E2", "Q1", "Q2", "Q3", "Q4"]

# Slugs rather than the German `position` and `stufe` store: a role also has a label and a badge
# Kuerzel, and a stored German word would be a third spelling for those two to drift from.
FLSpielerRolle = Literal["kapitaen", "co_kapitaen"]


class FLEinwilligung(BaseModel):
    """What this person agreed may be published about them.

    Required TOGETHER, as `FLAustritt` is: a scope with no confirmation date is a claim that
    somebody consented, and the surface reading this may not tell the two apart.
    """

    # Inline rather than a module-level alias, as the `spiele` quelle Literals are: each is used
    # once, and `MIRRORED_ENUMS` reads its members off the field.
    umfang: Literal["kader_oeffentlich", "intern"]
    # `bestandsuebernahme` is what a BACKFILLED row carries, so a record carried over from before
    # consent was collected stays distinguishable from one a person actually gave.
    erteilt_von: Literal["erziehungsberechtigt", "volljaehrig", "bestandsuebernahme"]
    # The day consent was given, and `None` for a carry-over: nobody was asked, so no day exists.
    datum: CustomOptionalDateString
    # `None` means UNCONFIRMED, which is not the same as absent: the admin membership read serves
    # this so a carried-over record shows as awaiting a confirmation rather than merely dateless.
    bestaetigt_am: CustomOptionalDateString


class _SpielerPerson(BaseModel):
    """The person's own two fields, shared so no read of a player declares them differently.

    The tiers put different CONTENT in `nachname` -- the base one an initial (`READ-PUPIL-001`)
    -- which is a projection's business and not a declaration's.
    """

    vorname: CustomNonEmptyString
    nachname: str | None


class _SaisonSpielerWritable(BaseModel):
    """The squad-row block every junction payload and echo repeats, beyond the ids and the retirement date each states itself."""

    team_id: CustomObjectId
    nummer: str | None
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    # True when the player joined a season already under way; the form derives it from the status.
    is_nachgetragen: bool
    # On the JUNCTION, not the person: a role is held within one team for one season. ONE field
    # rather than a flag per role, because two booleans can both be true and no validator sees a
    # second field to refuse it.
    rolle: FLSpielerRolle | None


class FLSpielerPublic(_SpielerPerson):
    """One squad row as the BASE TIER serves it -- all an anonymous visitor may read.

    `build_spieler_pipeline` withholds the rest: the surname is an initial (`READ-PUPIL-001`), the
    `stufe` is gone (`READ-PUPIL-002`), and the consent record with it.
    """

    # An ALLOW-LIST: every field is one this surface needs. Deriving it by subtracting what looks
    # sensitive puts each later addition to the document on the wire until somebody notices -- which
    # is how a consent record came to be published.
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    # Defaulted because an unnarrowed read joins LOOSELY: a person whose every squad row is retired
    # survives the unwind, and `$project` omits a joined key rather than nulling it. Required fields
    # would 500 the list over an ordinary retirement.
    nummer: str | None = None
    position: FLSpielerPosition | None = None


class FLSpieler(_SpielerPerson, _SaisonSpielerWritable):
    """The person as STORED, flattened against one season. A declared shape: NO endpoint returns it.

    `fl_backend/tests/core/test_constraints.py` mirrors the `spieler` validator against it, and
    `GET /spieler` answers with `FLSpielerPublic` instead.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    # Re-declared with defaults where the junction requires them: a squad row written before either
    # field existed still has to be describable, and a model that 422s describes it as impossible.
    is_nachgetragen: bool = False
    rolle: FLSpielerRolle | None = None
    # The day this PERSON left the league. Distinct from the squad row's own `inactive_since`: a
    # player who left one squad has a retired junction row and is still a player.
    inactive_since: CustomOptionalDateString
    # No default, unlike the two above: every stored row carries one after the backfill, and a
    # default here would let a row with no consent read back as though it had been asked.
    einwilligung: FLEinwilligung


FLSpielerListAdapter = TypeAdapter(list[FLSpielerPublic])


class FLSaisonSpielerRow(BaseModel):
    """The junction document as it is STORED -- the DECLARED SHAPE ONLY, validated against no read.

    `rolle` is the one defaulted key, and the one the validator leaves out of `required`: every
    stored row predates it. `app/api/spieler/admin_router.py :: _as_junction` defaults it likewise.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    spieler_id: CustomObjectId
    saison_id: str
    team_id: CustomObjectId
    is_nachgetragen: bool
    # DEFAULTED, alone on this model: every stored row predates the field, so the validator leaves
    # it out of `required` and a model requiring it would describe those rows as impossible.
    rolle: FLSpielerRolle | None = None
    stufe: FLSpielerStufe | None
    position: FLSpielerPosition | None
    # A STRING, never an int: squad numbers are worn, not counted, and "07" is a printed shirt.
    nummer: str | None
    # The day this SQUAD ROW was retired, which is not the day the person left the league.
    inactive_since: CustomOptionalDateString


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
    order: Literal["asc", "desc"] = Field(default="asc")


class FLPostSpielerPayload(BaseModel):
    """The PERSON. Everything a squad list shows is season-scoped and lives on the junction below."""

    model_config = ConfigDict(extra="forbid")

    vorname: str = Field(min_length=1, pattern=PERSON_NAME_PATTERN)
    # Optional here and REQUIRED on the patch below: a create has nothing to overwrite, while a
    # patch that omits it would erase a surname somebody typed.
    nachname: str | None = Field(default=None, pattern=PERSON_NAME_PATTERN)


class FLPatchSpielerPayload(BaseModel):
    """Replaces the person's names WHOLESALE.

    The handler `$set`s this model's dump, so a field with a default would let a form that forgot it
    write that default over a stored value.
    """

    model_config = ConfigDict(extra="forbid")

    vorname: str = Field(min_length=1, pattern=PERSON_NAME_PATTERN)
    nachname: str | None = Field(pattern=PERSON_NAME_PATTERN)


# Private, so the create and the edit state the bound once and the layer publishes no OpenAPI component.
class _SaisonSpielerPayload(_SaisonSpielerWritable):
    model_config = ConfigDict(extra="forbid")

    # Tightened on the WRITE side alone: a read model refusing a stored number would answer 500 for
    # the whole list over one row (`docs/backend/spec.md :: I36`).
    nummer: str | None = Field(pattern=SQUAD_NUMMER_PATTERN)


class FLPostSaisonSpielerPayload(_SaisonSpielerPayload):
    """One player's membership of one team's squad for one season.

    Every field is required, including those a squad often does not know: a caller states `null`
    rather than omitting, so the answer is theirs and not a default nobody chose.
    """

    saison_id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)


class FLPatchSaisonSpielerPayload(_SaisonSpielerPayload):
    """Replaces the squad row WHOLESALE — see `FLPatchSpielerPayload` for why nothing has a default.

    `team_id` is editable here: a mid-season transfer is a change to the junction row.
    """


class FLSpielerListResponse(BaseAPIResponse):
    spieler: list[FLSpielerPublic]


class FLSpielerSingleResponse(BaseAPIResponse):
    """One player as the BASE TIER serves them -- an allow-list of what this surface needs.

    Squad fields are season-scoped, and inventing a season would make the answer depend on a default
    nobody stated. `nachname` is an INITIAL here (`READ-PUPIL-001`).
    """

    spieler_id: CustomObjectId
    vorname: str
    nachname: str | None


class FLSpielerAdminSingleResponse(FLSpielerSingleResponse):
    """The same player echoed back to the admin who just wrote them, with their surname whole.

    `inactive_since` rides here alone: it IS the answer `DELETE` and `reactivate` give, and no public
    surface renders a pupil's leaving date.
    """

    inactive_since: str | None


class FLSpielerWriteResponse(BaseAPIResponse):
    spieler_id: CustomObjectId


class FLSpielerErasureResponse(BaseAPIResponse):
    """What the erasure removed, and NOT an echo of the person.

    A response repeating their names or their consent record would be a fresh copy of exactly what
    was erased, handed back over the wire.
    """

    spieler_id: CustomObjectId
    erased_saison_spieler: int
    # Every log row naming the person or one of those squad rows, images emptied and stamped
    # (`docs/backend/spec.md :: I42`). No row is dropped, so this is never a deletion count.
    redacted_aktionen: int


class FLSaisonSpielerResponse(_SaisonSpielerWritable, BaseAPIResponse):
    """A junction row, which has no read model of its own -- so it is echoed as it was written."""

    spieler_id: CustomObjectId
    saison_id: str
    inactive_since: str | None


class FLSpielerMembership(_SaisonSpielerWritable):
    """One squad row as seen from its player.

    Carries `inactive_since`, which the team junction does not: a player leaves a squad mid-season,
    where a team never leaves a season at all.
    """

    # Defaulted as `FLSpieler` is: this reads STORED rows, and the lookup projects a missing key
    # away rather than as null, so one row predating either field would 500 the whole list.
    is_nachgetragen: bool = False
    rolle: FLSpielerRolle | None = None

    saison_id: str
    inactive_since: CustomOptionalDateString


class FLSpielerWithMemberships(_SpielerPerson):
    """The person as stored, plus every squad row they hold.

    A DIFFERENT question from `FLSpieler`, not a projection: that one is FLATTENED against one
    season, so a player in two comes back as two indistinguishable rows.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    # The day the PERSON left the league; a squad row retires independently, on the membership above.
    inactive_since: CustomOptionalDateString
    # On the PERSON, as `inactive_since` is: consent is given by somebody, not per season. Defaulted
    # where `FLSpieler` requires it, because this model reads STORED rows and one written before the
    # field existed would 500 the whole list.
    einwilligung: FLEinwilligung | None = None
    memberships: list[FLSpielerMembership]


class FLSpielerMembershipsResponse(BaseAPIResponse):
    """Every player, retired ones included, each with their squad rows. Sorted by name."""

    spieler: list[FLSpielerWithMemberships]
