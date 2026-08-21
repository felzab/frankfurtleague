from typing import Literal, Self

from pydantic import BaseModel, Field, TypeAdapter, model_validator

# The three are imported rather than restated. Acyclic: none of these slices' MODELS imports this
# file -- `teams/services.py` does, and no model there.
from app.api.spiele.schemas import FLSaisonPhase
from app.api.spieler.schemas import FLSpielerStufe
from app.api.teams.schemas import FLGruppenNames
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, SAISON_ID_LENGTH
from app.shared.schemas.custom import CustomDateString, CustomObjectId, refuse_reversed_span
from app.shared.schemas.responses import BaseAPIResponse

FLSaisonStatus = Literal["past", "active", "future"]
FLSaisonsSortOptions = Literal["_id", "start_date", "end_date"]


class FLSaisonForfeitErgebnis(BaseModel):
    """What a fixture is awarded when one side does not appear.

    Both sides' goals rather than a margin, composed at `app/api/spiele/services.py :: apply_payload_to_spiel`.
    A LEVEL award needs a season with no knockout round (`REQ-RULES-010`).
    """

    sieger_tore: int = Field(ge=0)
    verlierer_tore: int = Field(ge=0)


class FLSaisonRules(BaseModel):
    win_points: int = Field(gt=0)
    draw_points: int = Field(ge=0)
    # No default: one would make the number a constant chosen here, as a hardcoded 3/1/0 would.
    qualifiers_per_group: int = Field(gt=0)

    # The season's capacity: a team enters only a group the season offers -- a prefix of the closed
    # A-D set -- and only while it has room. No default, for the reason above.
    number_of_groups: int = Field(gt=0, le=4)
    # The floor stops a group phase generating no fixture at all; the ceiling keeps the largest
    # legal season inside `app/shared/schemas/bounds.py :: LIST_LIMIT_DEFAULT`, past which a
    # season-scoped read truncates and its refusals cannot be trusted.
    teams_per_group: int = Field(ge=2, le=16)

    # Which figure separates two clubs level on points. No default, for the reason above.
    tiebreak_order: Literal["tordifferenz", "direkter_vergleich"]

    # A ceiling on one team's squad for one season, enforced at the squad write rather than here.
    max_kadergroesse: int = Field(gt=0)

    forfeit_ergebnis: FLSaisonForfeitErgebnis

    # No validator holds `saison_spieler` to this: it bounds what the FORM offers, so narrowing it
    # cannot invalidate a season already played.
    erlaubte_stufen: list[FLSpielerStufe] = Field(min_length=1)


class FLSaisonSpielplan(BaseModel):
    """What the generator left behind on the season it wrote.

    Counts rather than a hash: these are the two numbers an admin can compare against the page in
    front of them, and a hash answers no question anyone standing there is asking.
    """

    generiert_am: CustomDateString
    spieltage: int = Field(ge=0)
    spiele: int = Field(ge=0)


class FLSaisonPhaseSchedule(BaseModel):
    """One phase of a season: how many matchdays it takes, and how many matches each holds.

    A phase the bracket does not reach is ABSENT rather than present with zeroes, so the list IS the
    phases the season plays, in playing order.
    """

    phase: FLSaisonPhase
    matchdays: int = Field(ge=0)
    matches_per_matchday: int = Field(ge=0)


# Private, so the read model and both payloads state these fields once, and the base itself
# publishes no OpenAPI component.
class _SaisonWritable(BaseModel):
    # No span check at this level: `refuse_reversed_span` is payload-only, and a read refusing a
    # stored reversal would hide the row from the edit that repairs it.
    start_date: CustomDateString
    end_date: CustomDateString
    rules: FLSaisonRules


class _SaisonPayload(_SaisonWritable):
    @model_validator(mode="after")
    def the_season_ends_after_it_starts(self) -> Self:
        """The rule a `past` season's edit can still fail: its dates stay editable so a mistyped one can be repaired."""

        refuse_reversed_span(start=self.start_date, end=self.end_date, start_label="dem Startdatum", end_label="Das Enddatum")

        return self


class FLSaison(_SaisonWritable):
    # Exactly 4 characters, as every `saison_id` referencing this one demands: without it, an id
    # like "2026/27" validates here and every document pointing at it fails on read.
    id: str = Field(validation_alias="_id", serialization_alias="id", min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)

    status: FLSaisonStatus

    # DEFAULTED, as `FLSpiel.notiz` is: nothing tells a missing key from a stored null, and every
    # season written before the generator existed carries neither.
    spielplan: FLSaisonSpielplan | None = None

    # DERIVED, and on no document. Injected before validation, because a computed field would close
    # an import cycle.
    schedule: tuple[FLSaisonPhaseSchedule, ...]


FLSaisonListAdapter = TypeAdapter(list[FLSaison])


class FLSaisonsFilterParams(BaseModel):
    # No `saison_id`: this narrows a list, where `GET /saisons/{saison_id}` names one.
    status: FLSaisonStatus | None = None

    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    sort_by: FLSaisonsSortOptions = Field(default="_id")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLPostSaisonPayload(_SaisonPayload):
    # CHOSEN, not generated: `saisons._id` is the string every `saison_id` in the database
    # references, so this is the one create payload carrying an id.
    id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)


# The patch shape IS `_SaisonPayload`, and stays a name of its own: a private base publishes no
# OpenAPI component, and `fl_frontend/src/core/apiContract.test.ts` pairs the mirror by name.
class FLPatchSaisonPayload(_SaisonPayload):
    pass


class FLSwapGruppenPayload(BaseModel):
    """The two clubs a group swap exchanges. Symmetric.

    Neither side carries a `gruppe`: reading one from the payload would let a stale form write a
    group nobody stands in.
    """

    team1_id: CustomObjectId
    team2_id: CustomObjectId


class FLSwapGruppenResponse(BaseAPIResponse):
    """Both junction rows as the swap left them, plus `rewritten_spiele` -- the second half of the write, reported not assumed."""

    saison_id: str
    team1_id: CustomObjectId
    team1_gruppe: FLGruppenNames
    team2_id: CustomObjectId
    team2_gruppe: FLGruppenNames
    rewritten_spiele: int


class FLSaisonsListResponse(BaseAPIResponse):
    format: Literal["list"] = "list"
    saisons: list[FLSaison]


class FLSaisonsSingleResponse(BaseAPIResponse):
    format: Literal["single"] = "single"
    saison: FLSaison


class FLPostSaisonResponse(BaseAPIResponse):
    created_id: str


class FLPatchSaisonResponse(BaseAPIResponse):
    updated_document: FLSaison


class FLActivateSaisonResponse(BaseAPIResponse):
    """The season now active, plus how many were moved off it -- normally exactly one."""

    updated_document: FLSaison
    deactivated: int


class FLGenerateSpielplanResponse(BaseAPIResponse):
    """What the draw wrote, flat rather than nested.

    An admin reads the two counts without a second request, and they are the same numbers the
    season's own watermark keeps, so the two can be compared by eye.
    """

    saison_id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)
    spieltage: int = Field(ge=0)
    spiele: int = Field(ge=0)
    generiert_am: CustomDateString
