"""
SPIELER · models

Only `vorname` is required — everything else may be null while a squad entry is still being
filled in. Mirrored by `FLSpielerSchema` in the frontend.

Invariants:
- `position` and `stufe` are closed sets (ADR-0048); the `saison_spieler` validator refuses others.
- `nummer` is a string and stays free text — not unique within a squad, worn rather than counted.
- The person and the squad row retire independently (ADR-0025).
"""

from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.shared.schemas.custom import CustomObjectId, CustomOptionalDateString
from app.shared.schemas.responses import BaseAPIResponse

FLSpielerSortOptions = Literal["vorname", "nachname", "stufe", "nummer", "position"]

# The four positions, in the order a squad sheet lists them -- goalkeeper first, then out from the
# goal. `sort_by="position"` sorts the string, so every public squad list is alphabetical instead;
# changing that is not this tuple's job.
FLSpielerPosition = Literal["Tor", "Abwehr", "Mittelfeld", "Angriff"]

# The Hessen Oberstufe, both phases. E2 holds no row today and is still offered: the phases run in
# sequence, so a set stopping at what the current season happens to contain would refuse a legitimate
# entry the moment the year turns (ADR-0048).
FLSpielerStufe = Literal["E1", "E2", "Q1", "Q2", "Q3", "Q4"]

# A person's name: Unicode letters and the separators a real one uses, because an ASCII rule would
# refuse `Körner` and `El Damarawy`. Digits and every other symbol are out, which stops a note being
# typed into a name field.

# On the write payloads only, never on `FLSpieler`: a read model refusing a stored name 500s the whole
# response for one bad row.
PERSON_NAME_PATTERN = r"^\p{L}[\p{L}\-' ]*$"


class FLSpieler(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    # A player must at least have a first name; everything else may be absent while a squad entry
    # is still being filled in. Mirrored by FLSpielerSchema in the frontend.
    vorname: str = Field(min_length=1)
    nachname: str | None
    stufe: FLSpielerStufe | None
    nummer: str | None
    position: FLSpielerPosition | None
    is_nachgetragen: bool = False
    # The squad's captain for this season. On the JUNCTION, not the person: captaincy is a role
    # within one team for one season, and a player who captains 2026 need not captain 2027.
    is_captain: bool = False
    team_id: CustomObjectId
    # The day this PERSON left the league, or null. Distinct from the squad row's own
    # `inactive_since`: a player who left one team's squad has a retired junction row and is very much
    # still a player (ADR-0025).
    inactive_since: CustomOptionalDateString


FLSpielerListAdapter = TypeAdapter(list[FLSpieler])


class FLSpielerFilterParams(BaseModel):
    # `team_id` and `saison_id` stay here and are NOT paths. They narrow which players come back --
    # "the squad of that team" -- rather than naming which player, which is `GET /spieler/{spieler_id}`.
    team_id: CustomObjectId | None = None
    saison_id: str | None = None
    is_nachgetragen: bool | None = None
    # Closed since ADR-0048, so a misspelled year now comes back 422 rather than as an empty squad.
    stufe: FLSpielerStufe | None = None
    include_inactive: bool = False

    limit: int = Field(default=1024, ge=1, le=1024)
    sort_by: FLSpielerSortOptions = Field(default="position")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLPostSpielerPayload(BaseModel):
    """The PERSON. Everything a squad list shows is season-scoped and lives on the junction below."""

    vorname: str = Field(min_length=1, pattern=PERSON_NAME_PATTERN)
    # Optional here and REQUIRED on the patch below, and the asymmetry is deliberate: a create has
    # nothing to overwrite, so entering a team sheet forename-first is legitimate, while a patch that
    # omits it would erase a surname somebody typed.
    nachname: str | None = Field(default=None, pattern=PERSON_NAME_PATTERN)


class FLPatchSpielerPayload(BaseModel):
    """
    Replaces the person's names WHOLESALE.

    Every field is required with no default (ADR-0047's rule, which the team junction states for the
    same reason). The handler `$set`s this model's dump. A field with a default would therefore let a form that
    forgot it write that default over a stored value -- silently, because nothing distinguishes
    "omitted" from "deliberately cleared" once the dump is built. An omitted `nachname` is a 422.
    """

    vorname: str = Field(min_length=1, pattern=PERSON_NAME_PATTERN)
    nachname: str | None = Field(pattern=PERSON_NAME_PATTERN)


class FLPostSaisonSpielerPayload(BaseModel):
    """
    One player's membership of one team's squad for one season. `spieler_id` comes from the path.

    Every field is required, including the three a squad often does not know yet: a caller states
    `null` rather than omitting, which is what keeps `is_nachgetragen` an answer rather than a
    default nobody chose. That flag decides whether a player reads as a late arrival, and the one
    thing it must not be is quietly `False` because a caller forgot it (decided 2026-08-07).
    """

    saison_id: str = Field(min_length=4, max_length=4)
    team_id: CustomObjectId
    nummer: str | None
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    # True when the player joined a season that had already started. The admin form derives it from
    # the season's status rather than asking, so it cannot be forgotten there either.
    is_nachgetragen: bool
    is_captain: bool


class FLPatchSaisonSpielerPayload(BaseModel):
    """Replaces the squad row WHOLESALE — see `FLPatchSpielerPayload` for why nothing has a default."""

    # `team_id` is editable here because a player really does move between teams mid-season, and the
    # junction row is where that fact lives.
    team_id: CustomObjectId
    nummer: str | None
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    is_nachgetragen: bool
    is_captain: bool


class FLSpielerListResponse(BaseAPIResponse):
    spieler: list[FLSpieler]


class FLSpielerSingleResponse(BaseAPIResponse):
    """
    One player, from `GET /spieler/{spieler_id}`.

    Carries only the person: `vorname`, `nachname` and whether they are retired. The squad fields on
    `FLSpieler` -- team, number, position, stufe -- are season-scoped, so a player addressed without a
    season has none of them, and inventing a season here would make the answer depend on a default the
    caller never stated.
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
    """
    One squad row as seen from its player -- the season, the team, and what they wore and played.

    Carries `inactive_since`, which the team junction's equivalent does not and cannot: a squad row
    really is retired when a player leaves a team mid-season, while a team never leaves a season at
    all (ADR-0026). The admin list badges a retired row in place and offers the reactivate beside it.
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
    """
    The person as stored, plus every squad row they hold -- the admin list's one read.

    A DIFFERENT question from `FLSpieler`, not a projection of it (ADR-0027). `FLSpieler` is one
    player FLATTENED against one season, which is why it carries a `team_id` and no `saison_id`: the
    read that produces it unwinds the junction, so a player in two seasons comes back as two
    indistinguishable rows and a player in none fails validation on the `team_id` they have not got.
    The admin surface asks "every player, and which squads hold them", which that shape cannot answer
    at any filter setting.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    vorname: str = Field(min_length=1)
    nachname: str | None
    # The day the PERSON left the league. A squad row's own retirement is on the membership above,
    # and the two are independent (ADR-0025).
    inactive_since: CustomOptionalDateString
    memberships: list[FLSpielerMembership]


class FLSpielerMembershipsResponse(BaseAPIResponse):
    """Every player, retired ones included, each with their squad rows. Sorted by name."""

    spieler: list[FLSpielerWithMemberships]
