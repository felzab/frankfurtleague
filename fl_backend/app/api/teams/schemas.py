"""
TEAMS · models

The read shapes `GET /teams` discriminates by `format`, the single-team shape, the write payloads
and their echoes, plus the statistics model and the four-group container.

Invariants:
- `FLTeam` is flattened from three sources — `teams`, the junction row, and a derived `statistik`.
- Disqualified means `disqualifikation` is not null; there is no boolean beside it (ADR-0047).
- There is one team shape — never a reduced projection beside it (ADR-0027).
- `FLGruppen` always emits all four group keys, and only `build_gruppen` constructs it (ADR-0035).
- Statistics fields default to 0 — a team with no counting match is served zeros, not absence.
- `statistik_scope` decides which matches count and defaults to `"gruppenphase"` (ADR-0022).
- `FLTeam` is a read shape, `FLTeamRecord` the stored one — a write echoes the record.

See:
- app/api/teams/services.py — the join that flattens the three sources, and the standing
"""

from typing import Annotated, Literal, Mapping, Union

from pydantic import BaseModel, Field, RootModel, TypeAdapter

from app.shared.schemas.addresses import FLAddress
from app.shared.schemas.custom import CustomDateString, CustomExternalUrl, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.responses import BaseAPIResponse

FLGruppenNames = Literal["A", "B", "C", "D"]

# Which matches the derived table counts (ADR-0022). Two values rather than a free `saison_phase`
# filter: a table of the Halbfinale alone is not a standing, and offering it invites one.
# `"gruppenphase"` is the stored `FLSpiel.saison_phase` value.
FLTeamStatistikScope = Literal["gruppenphase", "gesamt"]


class FLDisqualifikation(BaseModel):
    """
    Why a team is out of one season, and from when (ADR-0047).

    Embedded on the `saison_teams` junction row and served from there. Its ABSENCE — the field holding
    `null` — is what "not disqualified" means, so nothing beside it records the same fact and the two
    cannot disagree. That is ADR-0025's shape applied to a second question, for the same reason: a
    boolean and a record together is the one arrangement with a state the database cannot refuse.

    `grund` is FREE TEXT and it is PUBLIC. It is written knowing it appears on the team's own page,
    which is the same trust this system already places in `teams.description`. A closed set was rejected
    because this league publishes no disciplinary code an enum could cite (ADR-0047).
    """

    grund: str = Field(min_length=1)
    # The day the disqualification took effect, not the day somebody typed it in. A German YYYY-MM-DD
    # string like every other date here (`datum`, `beginn`, `inactive_since`), so the frontend keeps one
    # parsing rule.
    datum: CustomDateString


class FLTeamStatistik(BaseModel):
    # `default=` by keyword, never `Field(0, ge=0)`: Pydantic treats the two identically, Pyright does
    # not. It reads the default by argument name, so a positional one leaves the field looking required
    # while tests and ruff stay silent.
    anzahl_gespielte_spiele: int = Field(default=0, ge=0)
    siege: int = Field(default=0, ge=0)
    niederlagen: int = Field(default=0, ge=0)
    unentschieden: int = Field(default=0, ge=0)
    tore_geschossen: int = Field(default=0, ge=0)
    tore_kassiert: int = Field(default=0, ge=0)
    punkte: int = Field(default=0, ge=0)


class FLTeam(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    name: str = Field(min_length=1)
    gruppe: FLGruppenNames
    statistik: FLTeamStatistik
    # Out of this season, with the reason and the date, or null while the team competes (ADR-0047).
    # Joined from the junction on every read and never copied into a match document (ADR-0021, rule 4).
    disqualifikation: FLDisqualifikation | None
    shorthand: str = Field(min_length=2, max_length=2)
    # May be empty -- not every team writes one. Capped so the public page and the editor's textarea
    # agree on what fits; the bound is Pydantic's and stays out of the validator
    # (`docs/backend/spec.md :: I16`).
    description: str = Field(max_length=4096)
    full_name: str = Field(min_length=1)
    # Rendered straight into an href on a public page, so the scheme is constrained here as well as
    # in the frontend. See validate_external_url for why this is not AnyHttpUrl.
    website_url: CustomExternalUrl
    address: FLAddress
    # The day this CLUB left the league, or null while it plays (ADR-0025). Not the same thing as
    # leaving one season: a team never leaves a season except by disqualification, which is
    # `disqualifikation` above and lives on the junction (ADR-0026).
    inactive_since: CustomOptionalDateString


FLTeamListAdapter = TypeAdapter(list[FLTeam])


class FLTeamRecord(BaseModel):
    """
    The club document as it is STORED — `FLTeam` minus the three fields no `teams` document carries.

    What the write endpoints echo back. A write to `teams` changes the club and nothing season-scoped,
    so `gruppe`, `disqualifikation` and `statistik` are not this endpoint's to report — and reading them
    would mean re-running the team pipeline, whose junction join is strict. A club with no
    `saison_teams` row for the current season drops out of that pipeline entirely, which is the normal
    state for a club being created, retired or reactivated.
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
    """
    The four groups, always all four, each already in standing order.

    Keyed by FLGruppenNames rather than a free-form str, and seeded with every group, so the response
    shape does not depend on which groups happen to have teams. Never build it from the teams present
    alone, for the reason `fl_backend/app/api/teams/services.py :: build_gruppen` states.

    **Built by `fl_backend/app/api/teams/services.py :: build_gruppen` and by nothing else.** The
    order inside each list is the competition's tiebreak chain, whose last criterion is the head-to-head table (ADR-0035)
    -- and that reads the season's matches, which a model holding only teams cannot see. Constructing
    this from a list of teams here would produce a table ordered on two of the four criteria, which is
    the ordering the bracket must not disagree with.
    """


class FLTeamMembership(BaseModel):
    """One junction row as seen from its club: which season, which group, and the record if any."""

    saison_id: str
    gruppe: FLGruppenNames
    disqualifikation: FLDisqualifikation | None


class FLTeamWithMemberships(FLTeamRecord):
    """
    The stored club document plus every season membership it holds — the admin list's one read.

    A DIFFERENT question from `FLTeam`, not a projection of it (ADR-0027): `FLTeam` answers "this
    club in one season" with a strict junction join and a derived `statistik`, which is why a club
    outside the season is absent from it by design. The admin surface asks "every club, and which
    seasons hold it", which no composition of season-scoped reads answers in one request.
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
    # The whole disqualification, or `null` to lift one. There is no second copy to keep in step,
    # because `FLSpiel` joins this from the junction rather than storing it (ADR-0021, rule 4).

    # No `default=None`: the field is required on the payload, so an omitted key cannot silently
    # reinstate a team. `PATCH` replaces the junction row's two writable fields wholesale, as `gruppe`
    # above does.
    disqualifikation: FLDisqualifikation | None


class FLTeamsFilterParams(BaseModel):
    # No `team_id`. One team by its id is an identity and is addressed by `GET /teams/{team_id}`;
    # what stays here narrows a list.
    saison_id: str | None = None
    gruppe: FLGruppenNames | None = None
    # A question about the junction, not a field on it -- nothing stores a boolean (ADR-0047). `true`
    # selects the teams holding a `disqualifikation` record, `false` those holding none, which
    # `build_team_pipeline` turns into a null test.
    is_disqualified: bool | None = None
    in_gruppen: bool | None = None
    include_inactive: bool = False

    # Defaults to the GROUP TABLE, so an omitted parameter is the correct standing rather than the
    # playoff-polluted one (ADR-0022). The all-games figures are an explicit ask.
    statistik_scope: FLTeamStatistikScope = Field(default="gruppenphase")

    limit: int = Field(default=1024, ge=1, le=1024)
    sort_by: Literal["name"] = Field(default="name")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLTeamSingleFilterParams(BaseModel):
    """
    What `GET /teams/{team_id}` accepts, which is deliberately far less than the list endpoint.

    A separate model rather than reusing `FLTeamsFilterParams`, whose remaining fields are meaningless
    here: `in_gruppen` groups a set of one, and `limit`/`sort_by`/`order` order a list that cannot have
    more than one member. Only the two choosing WHICH SEASON'S figures to derive belong, and those are
    genuine -- a team's `gruppe` and `statistik` do not exist outside a season (ADR-0019, ADR-0022).
    """

    saison_id: str | None = None
    statistik_scope: FLTeamStatistikScope = Field(default="gruppenphase")


class FLTeamsListResponse(BaseAPIResponse):
    format: Literal["list"] = "list"
    teams: list[FLTeam]


class FLTeamsGroupedResponse(BaseAPIResponse):
    """
    The four groups in standing order, and how many of each advance.

    `qualifiers_per_group` is the season's own `rules.qualifiers_per_group`, carried here because it is
    what turns an ordered list into a statement about qualification: the teams in a playoff place are a
    prefix of each list above, and a caller cannot mark them without knowing where it ends. It rides on
    this response rather than being fetched separately so that a page rendering the table cannot show a
    cutoff drawn from a different season than the table itself (ADR-0035).

    On the GROUPED shape only. A flat list is sorted by name and is not a standing, so a cutoff into it
    would mean nothing.
    """

    format: Literal["grouped"] = "grouped"
    gruppen: FLGruppen
    qualifiers_per_group: int = Field(gt=0)


class FLTeamsSingleResponse(BaseAPIResponse):
    """
    One team, from `GET /teams/{team_id}`.

    Deliberately not part of `FLTeamsResponse`: that union discriminates the shapes ONE endpoint can
    return, and this is a different endpoint returning exactly one shape.
    """

    format: Literal["single"] = "single"
    team: FLTeam


class FLPostTeamResponse(BaseAPIResponse):
    created_id: CustomObjectId


class FLPatchTeamResponse(BaseAPIResponse):
    updated_document: FLTeamRecord
    # How many embedded copies the rename reached. Reported rather than assumed: the fan-out is the
    # half of this endpoint that fails silently, so the count is the thing worth seeing.
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
