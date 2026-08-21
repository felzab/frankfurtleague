from typing import Annotated, Literal, Mapping, Union

from pydantic import BaseModel, Field, RootModel, TypeAdapter

from app.shared.schemas.addresses import FLAddress, FLAddressPayload
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, SAISON_ID_LENGTH, TEAM_DESCRIPTION_MAX_LENGTH, TEAM_SHORTHAND_LENGTH
from app.shared.schemas.custom import CustomDateString, CustomExternalUrl, CustomNonEmptyString, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.responses import BaseAPIResponse

FLGruppenNames = Literal["A", "B", "C", "D"]

# Two values rather than a free `saison_phase` filter: a table of the Halbfinale alone is not a
# standing, and offering it invites one.
FLTeamStatistikScope = Literal["gruppenphase", "gesamt"]


# A withdrawal is not a sanction, so the two routes out of a season are told apart rather than
# both filed as one. An alias because the bracket fault names it too.
FLAustrittType = Literal["disqualifikation", "rueckzug"]


class FLAustritt(BaseModel):
    """How a team came to be out of one season, why, and from when.

    `grund` is FREE TEXT and PUBLIC -- it appears on the team's page, and this league publishes no
    disciplinary code an enum could cite.
    """

    type: FLAustrittType
    grund: CustomNonEmptyString
    # The day the exit took effect, not the day somebody typed it in.
    datum: CustomDateString


class FLTeamStatistik(BaseModel):
    # `default=` by keyword, never `Field(0, ge=0)`: a positional one leaves the field looking
    # required to Pyright while ruff and the tests stay silent.
    anzahl_gespielte_spiele: int = Field(default=0, ge=0)
    siege: int = Field(default=0, ge=0)
    niederlagen: int = Field(default=0, ge=0)
    unentschieden: int = Field(default=0, ge=0)
    tore_geschossen: int = Field(default=0, ge=0)
    tore_kassiert: int = Field(default=0, ge=0)
    punkte: int = Field(default=0, ge=0)
    # Beside the scoring, never inside it: a forfeit is in this figure and in
    # `anzahl_gespielte_spiele` both (`docs/backend/spec.md :: I1d`).
    anzahl_abgesagte_spiele: int = Field(default=0, ge=0)


# Private, so the payloads, the stored record and the read model state these fields once, and the
# base itself publishes no OpenAPI component.
class _TeamWritable(BaseModel):
    name: CustomNonEmptyString
    shorthand: str = Field(min_length=TEAM_SHORTHAND_LENGTH, max_length=TEAM_SHORTHAND_LENGTH)
    # Capped so the public page and the editor's textarea agree on what fits; the bound stays out of
    # the database validator (`docs/backend/spec.md :: I16`).
    description: str = Field(max_length=TEAM_DESCRIPTION_MAX_LENGTH)
    full_name: CustomNonEmptyString
    # Rendered straight into an href on a public page, so the scheme is constrained here as well as
    # in the frontend (`fl_backend/app/shared/schemas/custom.py :: validate_external_url`).
    website_url: CustomExternalUrl
    address: FLAddress


class FLTeam(_TeamWritable):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    gruppe: FLGruppenNames
    statistik: FLTeamStatistik
    # Joined from the junction on every read, and copied into no match document.
    austritt: FLAustritt | None
    # The day this CLUB left the league. Leaving one season is `austritt` above.
    inactive_since: CustomOptionalDateString


FLTeamListAdapter = TypeAdapter(list[FLTeam])


class FLTeamRecord(_TeamWritable):
    """The club document as it is STORED, and what the write endpoints echo.

    The season-scoped fields would mean re-running the team pipeline, whose junction join is strict
    -- and a club being created holds no row yet.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    inactive_since: CustomOptionalDateString


class FLGruppen(RootModel[Mapping[FLGruppenNames, list[FLTeam]]]):
    """The four groups, always all four, in standing order.

    Built by `fl_backend/app/api/teams/services.py :: build_gruppen` alone: the order is the tiebreak
    chain, whose head-to-head criterion reads the season's matches.
    """


class FLTeamMembership(BaseModel):
    """One junction row as seen from its club: which season, which group, and the record if any."""

    saison_id: str
    gruppe: FLGruppenNames
    austritt: FLAustritt | None


class FLTeamWithMemberships(FLTeamRecord):
    """The stored club document plus every season membership it holds.

    A DIFFERENT question from `FLTeam`, not a projection: that one joins strictly against one season,
    so a club outside it is absent by design.
    """

    memberships: list[FLTeamMembership]


FLTeamWithMembershipsListAdapter = TypeAdapter(list[FLTeamWithMemberships])


class FLTeamsMembershipsResponse(BaseAPIResponse):
    """Every club, retired ones included, each with its memberships. Sorted by name."""

    teams: list[FLTeamWithMemberships]


# Private for `_TeamWritable`'s reason. The bounded address sits here rather than on that base, which
# `FLTeam`, `FLTeamRecord` and `FLTeamWithMemberships` share.
class _TeamPayload(_TeamWritable):
    address: FLAddressPayload


# Two names for one shape rather than an alias: the create and the edit are free to diverge, and an
# alias would carry a change to either one into the other.
class FLPostTeamPayload(_TeamPayload):
    pass


class FLPatchTeamPayload(_TeamPayload):
    pass


class FLPostSaisonTeamPayload(BaseModel):
    """One team's membership of one season. `team_id` comes from the path, `saison_id` from here."""

    saison_id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)
    gruppe: FLGruppenNames


class FLPatchSaisonTeamPayload(BaseModel):
    gruppe: FLGruppenNames
    # No `default=None`: `PATCH` replaces both writable fields wholesale, so an omitted key would
    # silently reinstate a team.
    austritt: FLAustritt | None


class FLTeamsFilterParams(BaseModel):
    # No `team_id`: one team by its id is addressed by `GET /teams/{team_id}`; this narrows a list.
    saison_id: str | None = None
    gruppe: FLGruppenNames | None = None
    # A question about the junction, not a field on it -- nothing stores a boolean. It asks whether
    # the club LEFT, by either route; `austritt_type` below is what narrows to one of them.
    has_austritt: bool | None = None
    # Independent of the boolean rather than nested under it: naming a type already implies having
    # left, so the two combine without either having to imply the other.
    austritt_type: FLAustrittType | None = None
    in_gruppen: bool | None = None
    include_inactive: bool = False

    # Defaults to the GROUP TABLE, so an omitted parameter is the correct standing rather than the
    # playoff-polluted one.
    statistik_scope: FLTeamStatistikScope = Field(default="gruppenphase")

    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    sort_by: Literal["name"] = Field(default="name")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLTeamSingleFilterParams(BaseModel):
    """What `GET /teams/{team_id}` accepts: only what chooses WHICH SEASON'S figures to derive."""

    saison_id: str | None = None
    # Spelled again rather than shared with `FLTeamsFilterParams`: a base holding this default would
    # put a ratified one behind an inheritance edit made for some unrelated field.
    statistik_scope: FLTeamStatistikScope = Field(default="gruppenphase")


class FLTeamsListResponse(BaseAPIResponse):
    format: Literal["list"] = "list"
    teams: list[FLTeam]


class FLTeamsGroupedResponse(BaseAPIResponse):
    """The four groups in standing order, and how many of each advance.

    `qualifiers_per_group` rides along rather than being fetched separately, so a page cannot mark a
    cutoff drawn from a different season than the table it marks.
    """

    format: Literal["grouped"] = "grouped"
    gruppen: FLGruppen
    qualifiers_per_group: int = Field(gt=0)


class FLTeamsSingleResponse(BaseAPIResponse):
    """One team, from `GET /teams/{team_id}`.

    Not part of `FLTeamsResponse`: that union discriminates the shapes ONE endpoint can return.
    """

    format: Literal["single"] = "single"
    team: FLTeam


class FLPostTeamResponse(BaseAPIResponse):
    created_id: CustomObjectId


class FLPatchTeamResponse(BaseAPIResponse):
    updated_document: FLTeamRecord
    # Reported rather than assumed: this fan-out is the half of the endpoint that fails silently (`docs/backend/spec.md :: I13`).
    fanned_out_to_spiele: int
    # Reported for the same reason, and separately: it is scoped to the seasons that are not `past`,
    # so zero means the club holds no row in one of those -- every season closed, or none entered.
    fanned_out_to_saison_teams: int


class FLTeamWriteResponse(BaseAPIResponse):
    """What the retire and reactivate endpoints echo. `FLTeamRecord`, for the reason stated on it."""

    updated_document: FLTeamRecord


class FLSaisonTeamResponse(BaseAPIResponse):
    """A junction row, which has no read model of its own -- so it is echoed as it was written."""

    saison_id: str
    team_id: CustomObjectId
    gruppe: FLGruppenNames
    austritt: FLAustritt | None
    # The season's own copy of the club's identity, on no payload: it is seeded from the club at
    # entry and rewritten by the rename fan-out, so a client supplying it could only be stale.
    name: CustomNonEmptyString
    shorthand: str = Field(min_length=TEAM_SHORTHAND_LENGTH, max_length=TEAM_SHORTHAND_LENGTH)


FLTeamsResponse = Annotated[
    Union[FLTeamsListResponse, FLTeamsGroupedResponse],
    Field(discriminator="format"),
]
