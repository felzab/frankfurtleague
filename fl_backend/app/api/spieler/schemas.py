from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.shared.schemas.custom import CustomObjectId, CustomOptionalDateString
from app.shared.schemas.responses import BaseAPIResponse

FLSpielerSortOptions = Literal["vorname", "nachname", "stufe", "nummer", "position"]

# In the order a squad sheet lists them. `sort_by="position"` sorts the STRING, so a public squad
# list is alphabetical instead.
FLSpielerPosition = Literal["Tor", "Abwehr", "Mittelfeld", "Angriff"]

# The Hessen Oberstufe, both phases. E2 is offered although no row holds it: a set stopping at what
# a season contains would refuse an entry as the year turns.
FLSpielerStufe = Literal["E1", "E2", "Q1", "Q2", "Q3", "Q4"]

# Unicode letters and the separators a real name uses, because an ASCII rule would refuse `Körner`.
# On the WRITE payloads only: a read model refusing a stored name 500s the response for one bad row.
PERSON_NAME_PATTERN = r"^\p{L}[\p{L}\-' ]*$"


class FLSpieler(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    vorname: str = Field(min_length=1)
    nachname: str | None
    stufe: FLSpielerStufe | None
    nummer: str | None
    position: FLSpielerPosition | None
    is_nachgetragen: bool = False
    # On the JUNCTION, not the person: captaincy is a role within one team for one season.
    is_captain: bool = False
    team_id: CustomObjectId
    # The day this PERSON left the league. Distinct from the squad row's own `inactive_since`: a
    # player who left one squad has a retired junction row and is still a player.
    inactive_since: CustomOptionalDateString


FLSpielerListAdapter = TypeAdapter(list[FLSpieler])


class FLSpielerFilterParams(BaseModel):
    # NOT paths: these narrow which players come back rather than naming one.
    team_id: CustomObjectId | None = None
    saison_id: str | None = None
    is_nachgetragen: bool | None = None
    # A closed set, so a misspelled year comes back 422 rather than as an empty squad.
    stufe: FLSpielerStufe | None = None
    include_inactive: bool = False

    limit: int = Field(default=1024, ge=1, le=1024)
    sort_by: FLSpielerSortOptions = Field(default="position")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLPostSpielerPayload(BaseModel):
    """The PERSON. Everything a squad list shows is season-scoped and lives on the junction below."""

    vorname: str = Field(min_length=1, pattern=PERSON_NAME_PATTERN)
    # Optional here and REQUIRED on the patch below: a create has nothing to overwrite, while a
    # patch that omits it would erase a surname somebody typed.
    nachname: str | None = Field(default=None, pattern=PERSON_NAME_PATTERN)


class FLPatchSpielerPayload(BaseModel):
    """Replaces the person's names WHOLESALE.

    The handler `$set`s this model's dump, so a field with a default would let a form that forgot it
    write that default over a stored value.
    """

    vorname: str = Field(min_length=1, pattern=PERSON_NAME_PATTERN)
    nachname: str | None = Field(pattern=PERSON_NAME_PATTERN)


class FLPostSaisonSpielerPayload(BaseModel):
    """One player's membership of one team's squad for one season.

    Every field is required, including those a squad often does not know: a caller states `null`
    rather than omitting, so the answer is theirs and not a default nobody chose.
    """

    saison_id: str = Field(min_length=4, max_length=4)
    team_id: CustomObjectId
    nummer: str | None
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    # True when the player joined a season already under way; the form derives it from the status.
    is_nachgetragen: bool
    is_captain: bool


class FLPatchSaisonSpielerPayload(BaseModel):
    """Replaces the squad row WHOLESALE — see `FLPatchSpielerPayload` for why nothing has a default."""

    # `team_id` is editable here: a mid-season transfer is a change to the junction row.
    team_id: CustomObjectId
    nummer: str | None
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    is_nachgetragen: bool
    is_captain: bool


class FLSpielerListResponse(BaseAPIResponse):
    spieler: list[FLSpieler]


class FLSpielerSingleResponse(BaseAPIResponse):
    """One player, from `GET /spieler/{spieler_id}`.

    The person alone: `FLSpieler`'s squad fields are season-scoped, and inventing a season would make
    the answer depend on a default the caller never stated.
    """

    spieler_id: CustomObjectId
    vorname: str
    nachname: str | None
    inactive_since: str | None


class FLSpielerWriteResponse(BaseAPIResponse):
    spieler_id: CustomObjectId


class FLSaisonSpielerResponse(BaseAPIResponse):
    """A junction row, which has no read model of its own -- so it is echoed as it was written."""

    spieler_id: CustomObjectId
    saison_id: str
    team_id: CustomObjectId
    nummer: str | None
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    is_nachgetragen: bool
    is_captain: bool
    inactive_since: str | None


class FLSpielerMembership(BaseModel):
    """One squad row as seen from its player.

    Carries `inactive_since`, which the team junction does not: a player leaves a squad mid-season,
    where a team never leaves a season at all.
    """

    saison_id: str
    team_id: CustomObjectId
    nummer: str | None
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    is_nachgetragen: bool
    is_captain: bool
    inactive_since: CustomOptionalDateString


class FLSpielerWithMemberships(BaseModel):
    """The person as stored, plus every squad row they hold.

    A DIFFERENT question from `FLSpieler`, not a projection: that one is FLATTENED against one
    season, so a player in two comes back as two indistinguishable rows.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    vorname: str = Field(min_length=1)
    nachname: str | None
    # The day the PERSON left the league; a squad row retires independently, on the membership above.
    inactive_since: CustomOptionalDateString
    memberships: list[FLSpielerMembership]


class FLSpielerMembershipsResponse(BaseAPIResponse):
    """Every player, retired ones included, each with their squad rows. Sorted by name."""

    spieler: list[FLSpielerWithMemberships]
