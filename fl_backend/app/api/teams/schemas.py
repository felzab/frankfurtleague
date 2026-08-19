from typing import Annotated, Literal, Mapping, Union

from pydantic import BaseModel, Field, RootModel, TypeAdapter

from app.shared.schemas.addresses import FLAddress
from app.shared.schemas.custom import CustomDateString, CustomExternalUrl, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.responses import BaseAPIResponse

FLGruppenNames = Literal["A", "B", "C", "D"]

# Two values rather than a free `saison_phase` filter: a table of the Halbfinale alone is not a
# standing, and offering it invites one.
FLTeamStatistikScope = Literal["gruppenphase", "gesamt"]


class FLDisqualifikation(BaseModel):
    """Why a team is out of one season, and from when.

    `grund` is FREE TEXT and PUBLIC -- it appears on the team's page, and this league publishes no
    disciplinary code an enum could cite.
    """

    grund: str = Field(min_length=1)
    # The day the disqualification took effect, not the day somebody typed it in.
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


class FLTeam(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    name: str = Field(min_length=1)
    gruppe: FLGruppenNames
    statistik: FLTeamStatistik
    # Joined from the junction on every read, and copied into no match document.
    disqualifikation: FLDisqualifikation | None
    shorthand: str = Field(min_length=2, max_length=2)
    # Capped so the public page and the editor's textarea agree on what fits; the bound stays out of
    # the database validator (`docs/backend/spec.md :: I16`).
    description: str = Field(max_length=4096)
    full_name: str = Field(min_length=1)
    # Rendered straight into an href on a public page, so the scheme is constrained here as well as
    # in the frontend (`fl_backend/app/shared/schemas/custom.py :: validate_external_url`).
    website_url: CustomExternalUrl
    address: FLAddress
    # The day this CLUB left the league. Leaving one season is `disqualifikation` above.
    inactive_since: CustomOptionalDateString


FLTeamListAdapter = TypeAdapter(list[FLTeam])


class FLTeamRecord(BaseModel):
    """The club document as it is STORED, and what the write endpoints echo.

    The season-scoped fields would mean re-running the team pipeline, whose junction join is strict
    -- and a club being created holds no row yet.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    name: str = Field(min_length=1)
    shorthand: str = Field(min_length=2, max_length=2)
    description: str = Field(max_length=4096)
    full_name: str = Field(min_length=1)
    website_url: CustomExternalUrl
    address: FLAddress
    inactive_since: CustomOptionalDateString


class FLGruppen(RootModel[Mapping[FLGruppenNames, list[FLTeam]]]):
    """The four groups, always all four, in standing order.

    Built by `fl_backend/app/api/teams/services.py :: build_gruppen` alone: the order is the tiebreak
    chain, whose last criterion reads the season's matches.
    """


class FLTeamMembership(BaseModel):
    """One junction row as seen from its club: which season, which group, and the record if any."""

    saison_id: str
    gruppe: FLGruppenNames
    disqualifikation: FLDisqualifikation | None


class FLTeamWithMemberships(FLTeamRecord):
    """The stored club document plus every season membership it holds.

    A DIFFERENT question from `FLTeam`, not a projection: that one joins strictly against one season,
    so a club outside it is absent by design.
    """

    memberships: list[FLTeamMembership]


class FLTeamsMembershipsResponse(BaseAPIResponse):
    """Every club, retired ones included, each with its memberships. Sorted by name."""

    teams: list[FLTeamWithMemberships]


class FLPostTeamPayload(BaseModel):
    name: str = Field(min_length=1)
    shorthand: str = Field(min_length=2, max_length=2)
    description: str = Field(max_length=4096)
    full_name: str = Field(min_length=1)
    website_url: CustomExternalUrl
    address: FLAddress


class FLPatchTeamPayload(BaseModel):
    name: str = Field(min_length=1)
    shorthand: str = Field(min_length=2, max_length=2)
    description: str = Field(max_length=4096)
    full_name: str = Field(min_length=1)
    website_url: CustomExternalUrl
    address: FLAddress


class FLPostSaisonTeamPayload(BaseModel):
    """One team's membership of one season. `team_id` comes from the path, `saison_id` from here."""

    saison_id: str = Field(min_length=4, max_length=4)
    gruppe: FLGruppenNames


class FLPatchSaisonTeamPayload(BaseModel):
    gruppe: FLGruppenNames
    # No `default=None`: `PATCH` replaces both writable fields wholesale, so an omitted key would
    # silently reinstate a team.
    disqualifikation: FLDisqualifikation | None


class FLTeamsFilterParams(BaseModel):
    # No `team_id`: one team by its id is addressed by `GET /teams/{team_id}`; this narrows a list.
    saison_id: str | None = None
    gruppe: FLGruppenNames | None = None
    # A question about the junction, not a field on it -- nothing stores a boolean.
    is_disqualified: bool | None = None
    in_gruppen: bool | None = None
    include_inactive: bool = False

    # Defaults to the GROUP TABLE, so an omitted parameter is the correct standing rather than the
    # playoff-polluted one.
    statistik_scope: FLTeamStatistikScope = Field(default="gruppenphase")

    limit: int = Field(default=1024, ge=1, le=1024)
    sort_by: Literal["name"] = Field(default="name")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLTeamSingleFilterParams(BaseModel):
    """What `GET /teams/{team_id}` accepts: only what chooses WHICH SEASON'S figures to derive."""

    saison_id: str | None = None
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
    # Reported rather than assumed: the fan-out is the half of this endpoint that fails silently.
    fanned_out_to_spiele: int


class FLTeamWriteResponse(BaseAPIResponse):
    """What the retire and reactivate endpoints echo. `FLTeamRecord`, for the reason stated on it."""

    updated_document: FLTeamRecord


class FLSaisonTeamResponse(BaseAPIResponse):
    """A junction row, which has no read model of its own -- so it is echoed as it was written."""

    saison_id: str
    team_id: CustomObjectId
    gruppe: FLGruppenNames
    disqualifikation: FLDisqualifikation | None


FLTeamsResponse = Annotated[
    Union[FLTeamsListResponse, FLTeamsGroupedResponse],
    Field(discriminator="format"),
]
