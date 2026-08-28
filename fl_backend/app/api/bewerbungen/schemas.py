from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter

# Imported rather than restated: an application's three people BECOME the junction's three people at
# acceptance, so a second declaration of the block is one the two would drift apart on. Acyclic --
# no model in `teams` imports this slice.
from app.api.teams.schemas import FLGruppenNames, FLSaisonTeamKontakte, FLSchulform, FLTrikotFarbe
from app.shared.schemas.addresses import FLAddress
from app.shared.schemas.bounds import BEWERBUNG_GRUND_MAX_LENGTH, LIST_LIMIT_MAX, TEAM_SHORTHAND_LENGTH
from app.shared.schemas.custom import CustomDateString, CustomNonEmptyString, CustomObjectId
from app.shared.schemas.responses import BaseAPIResponse

# `eingereicht` is the only state a submission arrives in; the other two are the triage's, and
# `app/api/bewerbungen/admin_router.py` is the only writer of either.
FLBewerbungStatus = Literal["eingereicht", "angenommen", "abgelehnt"]

FLBewerbungenSortOptions = Literal["eingereicht_am", "saison_id"]


class FLBewerbungSchule(BaseModel):
    """The club a new school proposes, in the shape acceptance will create it in.

    While the application is `eingereicht`, exactly one of this and `team_id` carries a value, held
    by the write path rather than the validator (`docs/backend/spec.md :: I16`).
    """

    # `team_name`, not `name`: it becomes the club's SHORT name beside `full_name`, and `name` inside
    # a block called `schule` would read as the school's own.
    team_name: CustomNonEmptyString
    full_name: CustomNonEmptyString
    shorthand: str = Field(min_length=TEAM_SHORTHAND_LENGTH, max_length=TEAM_SHORTHAND_LENGTH)
    schulform: FLSchulform | None
    address: FLAddress
    # A plain string, unlike `_TeamWritable.website_url`: stored values are typed only
    # (`docs/backend/spec.md :: I16`), and refusing one on read would 500 the triage list over the
    # row an administrator must decline (`docs/backend/spec.md :: I36`).
    website_url: str


class FLBewerbungTrikot(BaseModel):
    """What kit the school already owns, and the colour it would like.

    Never copied onto the team: `saison_teams.trikot_farbe` is the colour an administrator ASSIGNED,
    and two schools may wish for one colour.
    """

    vorhandener_satz: str
    wunschfarbe: FLTrikotFarbe | None


class FLBewerbungKader(BaseModel):
    """The school's own estimate of its squad, on the application alone.

    Unbounded on read for `FLBewerbungSchule.website_url`'s reason. Nothing checks either number
    against a squad afterwards -- they are what the school expected, not what it fielded.
    """

    voraussichtliche_groesse: int
    gute_spieler: int | None


class FLBewerbungEntscheidung(BaseModel):
    """Who decided this application, when, and -- on a decline -- why.

    `von` is the administrator the request was attributed to, so a decision and the `aktionen` row
    recording it can never name two different people.
    """

    getroffen_am: CustomDateString
    von: str
    # Null on an acceptance: what an acceptance did is the club and the junction row it wrote, and a
    # reason field filled in with "angenommen" would be a second, weaker record of that.
    grund: str | None


class FLBewerbung(BaseModel):
    """One school's application to play one season, as it is stored.

    The submission is never rewritten: only `status`, `entscheidung` and `team_id` move, and only
    through the two triage endpoints.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    saison_id: str
    eingereicht_am: CustomDateString
    status: FLBewerbungStatus
    # The club the applicant PICKED, null where they proposed a new school. Acceptance writes the
    # created club's id back here, so a decided application always names one.
    team_id: CustomObjectId | None
    schule: FLBewerbungSchule | None
    kontakte: FLSaisonTeamKontakte
    trikot: FLBewerbungTrikot
    kader: FLBewerbungKader
    entscheidung: FLBewerbungEntscheidung | None


FLBewerbungListAdapter = TypeAdapter(list[FLBewerbung])


class FLBewerbungenFilterParams(BaseModel):
    """What the triage list may narrow on. No `bewerbung_id`: `GET /bewerbungen/{bewerbung_id}` names one."""

    saison_id: str | None = None
    status: FLBewerbungStatus | None = None

    # Null is "the caller named no bound", and no query string spells it. FastAPI fills every field
    # of a `Depends()` model, so `model_fields_set` cannot tell an omitted parameter from a sent one.
    limit: int | None = Field(default=None, ge=1, le=LIST_LIMIT_MAX)
    # Newest first by default: the triage is a queue, and the oldest open application is the one an
    # administrator has already seen.
    sort_by: FLBewerbungenSortOptions = Field(default="eingereicht_am")
    order: Literal["asc", "desc"] = Field(default="desc")


class FLAnnehmenBewerbungPayload(BaseModel):
    """Which group the school enters, and the kit colour the league assigns it.

    No `saison_id`: the application names its own season, so a payload carrying one could only
    disagree with it.
    """

    model_config = ConfigDict(extra="forbid")

    gruppe: FLGruppenNames
    # Assigned rather than read off `trikot.wunschfarbe`: a wish is not an assignment, and two
    # schools may wish for one colour.
    trikot_farbe: FLTrikotFarbe | None


class FLAblehnenBewerbungPayload(BaseModel):
    """Why the application was declined.

    Its own declaration and never shared with the acceptance's: the two are not inverses, and a
    payload reaching both would let a value typed for one arrive at the other.
    """

    model_config = ConfigDict(extra="forbid")

    # Required, and STRIPPED before either bound counts: both count characters, so spaces alone
    # would reach the application and the applicants' email as a decline stating nothing, and a
    # padded reason is trimmed to fit rather than refused.
    grund: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=BEWERBUNG_GRUND_MAX_LENGTH)]


class FLBewerbungenListResponse(BaseAPIResponse):
    bewerbungen: list[FLBewerbung]


class FLBewerbungSingleResponse(BaseAPIResponse):
    bewerbung: FLBewerbung


class FLAnnehmenBewerbungResponse(BaseAPIResponse):
    """The application as the acceptance left it, plus what the acceptance wrote beyond it."""

    updated_document: FLBewerbung
    # The club now standing in the season: the one the applicant picked, or the one this acceptance
    # created. Echoed because a created club has an id the caller has no other way to learn.
    team_id: CustomObjectId
    # Whether this acceptance created that club, which the admin surface words differently either
    # way. Derivable from `updated_document.schule` and served anyway: what the caller renders is
    # what this call DID, not what the application holds.
    created_team: bool
    # Unconstrained, as an echo of a stored id is (`docs/backend/spec.md :: I5`).
    saison_id: str
    gruppe: FLGruppenNames
    trikot_farbe: FLTrikotFarbe | None


class FLAblehnenBewerbungResponse(BaseAPIResponse):
    updated_document: FLBewerbung
