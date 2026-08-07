"""
TEAMS · models

The read shapes `GET /teams` discriminates by `format`, the single-team shape, the write payloads and
their echoes, plus the statistics model and the four-group container.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `FLTeam` is FLATTENED from more than one source: the season-independent `teams` record, the
    `gruppe` and `disqualifikation` of the `saison_teams` junction row, and a `statistik` computed from
    the season's matches. That is why fields exist here that no single collection carries.
  • A team is disqualified exactly when `disqualifikation` is not null. There is no boolean beside it
    anywhere, on this model or in the database, because a flag and a record can disagree and no
    `$jsonSchema` validator can say they must not (ADR-0059, ADR-0027).
  • There is ONE team shape. Never add a reduced projection beside it (ADR-0034).
  • `FLGruppen` always emits all four group keys, even empty ones. A map built from the teams present
    omits "D" for a season with nobody in it, and the frontend schema requires all four.
  • `FLGruppen` is built by `fl_backend/app/api/teams/services.py :: build_gruppen` and by nothing
    else. Its lists are in standing order, and the chain's last criterion reads the season's matches
    (ADR-0043) -- which is why the construction cannot live on a model that holds only teams.
  • Statistics fields are all `ge=0` and default to 0. The default is load-bearing: a team whose season
    holds no counting match is served a zeroed object, not an absent one.
  • `statistik_scope` decides WHICH matches those seven numbers count, and it defaults to
    `"gruppenphase"`. The response shape is identical either way, so a caller that gets the scope wrong
    gets a plausible table rather than an error -- which is why the safe value is the default.
  • The `format` discriminator is what lets one endpoint return a list or the four groups. Adding a
    shape means adding a literal, not widening an existing model.
  • `FLTeam` is a READ shape and `FLTeamRecord` is the STORED one. A write endpoint echoes the record:
    it changed no season-scoped field, and re-reading one through the pipeline would 404 for a club
    with no junction row in the current season.

 DECISIONS ────────────────────────────────────────────────────────────────────────────────────────────────

  ADR-0026  statistik is derived from the matches on every read
  ADR-0029  the table counts the Gruppenphase, and that is the default scope
  ADR-0032  `inactive_since` is the day the club left the league
  ADR-0034  one team shape, no reduced projection
  ADR-0043  one tiebreak chain orders the table and seeds the bracket
  ADR-0059  a disqualification is a record, and its absence is the null

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  fl_backend/app/api/teams/services.py -- the join that flattens the three sources, and the standing
"""

from typing import Annotated, Literal, Mapping, Union

from pydantic import BaseModel, Field, RootModel, TypeAdapter

from app.shared.schemas.addresses import FLAddress
from app.shared.schemas.custom import CustomDateString, CustomExternalUrl, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.responses import BaseAPIResponse

FLGruppenNames = Literal["A", "B", "C", "D"]

# Which matches the derived table counts (ADR-0029). Two values rather than a free `saison_phase`
# filter: a table of the Halbfinale alone is not a standing anybody wants, and offering it invites
# one. `"gruppenphase"` is spelled exactly as the stored `FLSpiel.saison_phase` value it filters on.
FLTeamStatistikScope = Literal["gruppenphase", "gesamt"]


class FLDisqualifikation(BaseModel):
    """
    Why a team is out of one season, and from when (ADR-0059).

    Embedded on the `saison_teams` junction row and served from there. Its ABSENCE — the field holding
    `null` — is what "not disqualified" means, so nothing beside it records the same fact and the two
    cannot disagree. That is ADR-0032's shape applied to a second question, for the same reason: a
    boolean and a record together is the one arrangement with a state the database cannot refuse.

    `grund` is FREE TEXT and it is PUBLIC. It is written knowing it appears on the team's own page,
    which is the same trust this system already places in `teams.description`. A closed set was rejected
    because this league publishes no disciplinary code an enum could cite (ADR-0059).
    """

    grund: str = Field(min_length=1)
    # The day the disqualification took effect, not the day somebody typed it in. A German YYYY-MM-DD
    # string like every other date here (`datum`, `beginn`, `inactive_since`), so the frontend keeps one
    # parsing rule.
    datum: CustomDateString


class FLTeamStatistik(BaseModel):
    # `default=` by keyword, never `Field(0, ge=0)`. Pydantic treats the two identically; the type
    # checker does not. Pyright reads a field specifier's default by ARGUMENT NAME, so a positional
    # one leaves it believing the field is required -- and every construction that omits it is then
    # flagged in the editor while the tests and ruff stay silent.
    anzahl_gespielte_spiele: int = Field(default=0, ge=0)
    siege: int = Field(default=0, ge=0)
    niederlagen: int = Field(default=0, ge=0)
    unentschieden: int = Field(default=0, ge=0)
    tore_geschossen: int = Field(default=0, ge=0)
    tore_kassiert: int = Field(default=0, ge=0)
    punkte: int = Field(default=0, ge=0)


class FLTeam(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through

    name: str = Field(min_length=1)
    gruppe: FLGruppenNames
    statistik: FLTeamStatistik
    # Out of THIS season, with the reason and the date, or null while the team competes (ADR-0059).
    # Joined from the junction on every read and never copied into a match document, so a
    # disqualification entered here reaches every surface at once (ADR-0028, rule 4).
    disqualifikation: FLDisqualifikation | None
    shorthand: str = Field(min_length=2, max_length=2)
    # May be empty -- not every team writes one. Capped so the public page and the editor's
    # textarea agree on what fits; the bound is Pydantic's and stays out of the validator (I16).
    description: str = Field(max_length=4096)
    full_name: str = Field(min_length=1)
    # Rendered straight into an href on a public page, so the scheme is constrained here as well as
    # in the frontend. See validate_external_url for why this is not AnyHttpUrl.
    website_url: CustomExternalUrl
    address: FLAddress
    # The day this CLUB left the league, or null while it plays (ADR-0032). Not the same thing as
    # leaving one season: a team never leaves a season except by disqualification, which is
    # `disqualifikation` above and lives on the junction (ADR-0033).
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
    alone: a season with nobody in group D would omit the "D" key, the frontend's FLGruppenSchema
    requires all four, and /dashboard/saisontabelle fails to parse the response. Every season so far has
    had teams in all four groups, so that failure hides until it does not.

    **Built by `fl_backend/app/api/teams/services.py :: build_gruppen` and by nothing else.** The
    order inside each list is the competition's tiebreak chain, whose last criterion is the head-to-head table (ADR-0043)
    -- and that reads the season's matches, which a model holding only teams cannot see. Constructing
    this from a list of teams here would produce a table ordered on two of the four criteria, which is
    the ordering the bracket must not disagree with.
    """


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
    # The whole disqualification, or `null` to lift one. There is no second copy anywhere to keep in
    # step, because `FLSpiel` joins this from the junction rather than storing it (ADR-0028, rule 4).
    #
    # No `default=None`: the field is REQUIRED on the payload, so an omitted key cannot silently
    # reinstate a team the admin never meant to touch. `PATCH` here replaces the junction row's two
    # writable fields wholesale, exactly as `gruppe` above already does.
    disqualifikation: FLDisqualifikation | None


class FLTeamsFilterParams(BaseModel):
    # No `team_id`. One team by its id is an identity and is addressed by `GET /teams/{team_id}`;
    # what stays here narrows a list.
    saison_id: str | None = None
    gruppe: FLGruppenNames | None = None
    # A QUESTION about the junction, not a field on it -- nothing stores a boolean any more (ADR-0059).
    # `true` selects the teams holding a `disqualifikation` record and `false` those holding none, which
    # `build_team_pipeline` translates into a null test. Kept as a boolean because that is the only
    # useful shape for the question: nobody filters a list by the wording of a reason.
    is_disqualified: bool | None = None
    in_gruppen: bool | None = None
    include_inactive: bool = False  # Exclude clubs that have left the league by default

    # Defaults to the GROUP TABLE, so an omitted parameter is the correct standing rather than the
    # playoff-polluted one (ADR-0029). The all-games figures are an explicit ask.
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
    genuine -- a team's `gruppe` and `statistik` do not exist outside a season (ADR-0026, ADR-0029).
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
    cutoff drawn from a different season than the table itself (ADR-0043).

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


# Pydantic uses the 'format' field to decide which model to validate against
FLTeamsResponse = Annotated[
    Union[FLTeamsListResponse, FLTeamsGroupedResponse],
    Field(discriminator="format"),
]
