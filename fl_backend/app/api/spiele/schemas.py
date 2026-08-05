"""
SPIELE · models

The Spiel read model, the admin patch payload, and the three embedded field models they share.

These are HAND-MIRRORED by `fl_frontend/src/features/spiele/schemas.ts` in Zod. There is no generation
step, so a constraint changed here must be changed there in the same commit.

A gate check compares the two (ADR-0040): edit a model here, regenerate the published document with
`python -m tests.openapi_document --write`, and `fl_frontend/src/core/apiContract.test.ts` fails naming
any field whose presence, requiredness, nullability, primitive type or enum members moved. It does NOT
compare patterns, lengths or ranges — those are still yours to keep in step by hand, and are the first
thing to check when behaviour looks impossible.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • The three embedded field models are declared BEFORE the payload and FLSpiel that reference them --
    see the note below, this has bitten before.
  • A fixture side is `None` when its occupant is not yet known, and `teamN_quelle` says where that
    occupant comes from (ADR-0041, ADR-0042). The two fields are INDEPENDENT and nothing pairs them:
    `quelle` is a fact about the FIXTURE and stays true once the team arrives, while the team field is a
    display copy the rename fan-out maintains (ADR-0028, rules 2 and 3). All four combinations are
    meaningful, so a reader takes the team, then the label derived from `quelle`, then "Noch offen", and
    never asks which state it is in.
  • `quelle` is a REFERENCE, not a label. It carries no German and no display text: the two variants are
    the two ways a bracket slot is fed -- by a group placing, which is every first knockout round, and
    by an earlier match, which is every round after it. The frontend derives what a card shows.
  • Money fields (`mietpreis`, `payment`) carry NO default. The admin patch writes the payload back
    wholesale with `$set`, so a default lets a request omitting the field silently overwrite a real
    value with 0.
  • `ergebnis` is pattern-constrained rather than free text, and uses `[0-9]` rather than `\\d`: the
    backend's regex engine treats `\\d` as Unicode-aware, and `Number("٢")` in JavaScript is NaN, so the
    two ends would disagree about what a digit is.
  • `saison_id` is exactly 4 characters, matching FLSaison.id.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/backend/spec.md -- section 4, the field-constraint table
  docs/glossary.md -- Ergebnis, Tore, saison_phase
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, TypeAdapter, model_validator

from app.api.teams.schemas import FLGruppenNames
from app.shared.schemas.custom import CustomDateString, CustomObjectId, CustomOptionalDateString, CustomOptionalTimeString, CustomTimeString
from app.shared.schemas.responses import BaseAPIResponse

FLSaisonPhase = Literal["gruppenphase", "viertelfinale", "halbfinale", "finale"]
FLSpielStatus = Literal["ausstehend", "vergangen", "heute", "abgesagt", "unbekannt"]


# The three embedded field models are declared BEFORE the payload and FLSpiel that reference them.
# With them below, those models resolved only through PEP 649 deferred annotations plus pydantic's
# lazy rebuild -- __pydantic_complete__ stayed False until the first validation, so anything reaching
# into the core schema earlier raised PydanticUserError instead of a clean ValidationError.
class FLSpielTeamField(BaseModel):
    team_id: CustomObjectId
    name: str = Field(min_length=1)
    tore: Annotated[int, Field(ge=0)] | None
    shorthand: str = Field(min_length=2, max_length=2)


class FLSpielOrtField(BaseModel):
    spielort_id: CustomObjectId
    name: str = Field(min_length=1)
    # Free text (venue name + address) searched on Google Maps, NOT a URL -- so no scheme check.
    maps_link: str = Field(min_length=1)
    # int, not float: a rental price is whole euros. Stored values are already integral.
    #
    # Required, with no default, on BOTH paths this model serves:
    #   write -- the admin PATCH writes the payload back wholesale with $set (admin/router.py), so a
    #            default let a request omitting the field silently overwrite a venue's rent with 0,
    #            while the sibling `payment` below correctly 422'd in the same situation.
    #   read  -- FLSpielOrtField is embedded in FLSpiel, so this also validates every document read
    #            out of Mongo. Verified before removing the default: 25 of 25 spiele with an `ort`
    #            carry `mietpreis`, and the frontend's FLSpielOrtFieldSchema has always required it,
    #            so a document without it would already have been failing the client-side parse.
    mietpreis: int = Field(ge=0)


class FLSpielSchiedsrichterField(BaseModel):
    schiedsrichter_id: CustomObjectId
    name: str = Field(min_length=1)
    payment: int = Field(ge=0)


class FLSpielQuelleGruppe(BaseModel):
    """A slot fed by the group phase: the team finishing `platz` in `gruppe`."""

    # `type`, not the German `Art`: the discriminator names the shape of this object rather than
    # anything in the competition, so it is structural vocabulary and stays English -- as `format` on
    # the teams response already does. The two VALUES it takes are domain terms and stay German.
    type: Literal["gruppe"]
    gruppe: FLGruppenNames
    platz: int = Field(gt=0)


class FLSpielQuelleSpiel(BaseModel):
    """A slot fed by an earlier fixture: the side that came out of match `spiel_nr` as `ausgang`."""

    type: Literal["spiel"]
    # Deliberately a spiel_nr and not an ObjectId. A bracket is drawn by match number, the number is
    # unique within a season (`fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`), and an id would
    # make the draw depend on which documents already exist.
    spiel_nr: int = Field(gt=0)
    # `verlierer` exists because a third-place play-off is fed by the two losing semi-finals. Nothing
    # writes it yet; the bracket cannot express one without it.
    ausgang: Literal["sieger", "verlierer"]


# The two ways a bracket slot is fed, and there is no third. The first knockout round is always seeded
# from the group phase; every round after it is fed by matches in the round before (ADR-0042). Tagged
# rather than a bare union: `type` is what lets Pydantic, the Zod mirror and every reader pick a variant
# without inspecting which keys happen to be present.
FLSpielQuelle = Annotated[FLSpielQuelleGruppe | FLSpielQuelleSpiel, Field(discriminator="type")]


class FLUnresolvableSlot(BaseModel):
    """
    One bracket slot whose `gruppe` reference names a placing the standings will never hand it.

    Both reasons need a person, which is what separates them from the ordinary state of a group that is
    simply still being played -- that one is reported by nobody, because "not yet" is not a problem
    (ADR-0043).

    `gruppe_too_small` is a data-entry mistake: the group holds fewer teams that can hold a placing than
    the `platz` asks for, so no result will ever produce it. Like a `spiel_nr` naming no match, the slot
    is left exactly as it stands -- erasing a team over a typo destroys more than it reports (ADR-0042).

    `tie_unresolved` is a real outcome: the group is played out and the tiebreak chain still cannot
    separate two teams at that placing. The slot IS emptied, because naming either team would be a
    guess, and clearing the `quelle` and entering a side by hand is the route past it.
    """

    spiel_nr: int = Field(gt=0)
    gruppe: FLGruppenNames
    platz: int = Field(gt=0)
    reason: Literal["gruppe_too_small", "tie_unresolved"]


class FLPatchSpielDataPayload(BaseModel):
    # No `spiel_id`: the match being changed is named by the path (RFC 5789 -- the Request-URI
    # identifies the resource, the body describes the change).
    is_canceled: bool

    team1: FLSpielTeamField | None
    team2: FLSpielTeamField | None

    # On the payload because it is written wholesale with `$set`: a field the request omits is
    # OVERWRITTEN, not preserved, so leaving these off would erase a bracket's wiring on the first
    # edit of any other field.
    team1_quelle: FLSpielQuelle | None
    team2_quelle: FLSpielQuelle | None

    datum: CustomOptionalDateString
    uhrzeit: CustomOptionalTimeString
    ort: FLSpielOrtField | None
    schiedsrichter: FLSpielSchiedsrichterField | None

    @model_validator(mode="before")
    @classmethod
    def empty_strings_to_none(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: (None if isinstance(v, str) and v.strip() == "" else v) for k, v in data.items()}
        return data


class FLSpiel(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through id

    # `None` while the occupant is unknown -- a playoff slot the group phase has not filled yet. The
    # opponent is MODELLED as absent rather than impersonated by a placeholder team (ADR-0041).
    team1: FLSpielTeamField | None
    team2: FLSpielTeamField | None

    # Where each side comes from, as a REFERENCE the bracket is drawn from -- never derived and never
    # fanned out into, unlike the `name` above, which is a display copy of `teams.name` (ADR-0028,
    # rule 3). Null on a group-phase fixture, and null on any slot an admin has taken manual charge of.
    team1_quelle: FLSpielQuelle | None
    team2_quelle: FLSpielQuelle | None

    datum: CustomDateString | None
    uhrzeit: CustomTimeString | None

    ort: FLSpielOrtField | None
    schiedsrichter: FLSpielSchiedsrichterField | None

    # "Tore:Tore", or null when the match has not been played. Parsed as structured data by the
    # frontend, which derives win/draw/loss from it -- a malformed value rendered as a loss for
    # both teams before this was constrained.
    ergebnis: Annotated[str, StringConstraints(pattern=r"^[0-9]+:[0-9]+$")] | None
    spieltag_id: CustomObjectId
    spiel_nr: int = Field(gt=0)

    is_canceled: bool
    saison_phase: FLSaisonPhase
    saison_id: str = Field(min_length=4, max_length=4)


FLSpielListAdapter = TypeAdapter(list[FLSpiel])


class FLSpieleFilterParams(BaseModel):
    saison_id: str | None = None
    saison_phase: Literal["playoffs"] | FLSaisonPhase | None = None
    spiel_status: FLSpielStatus | None = None
    team_id: CustomObjectId | None = None

    limit: int = Field(default=1024, ge=1, le=1024)
    sort_by: Literal["datum", "uhrzeit", "spiel_nr", "saison_phase"] = Field(default="datum")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSpieleListResponse(BaseAPIResponse):
    spiele: list[FLSpiel]


class FLSpieleSingleResponse(BaseAPIResponse):
    spiel: FLSpiel


class FLPatchSpielDataResponse(BaseAPIResponse):
    """
    What `patch_spiel_data` returns: the envelope, plus the fixtures it moved.

    `advanced_to` carries the `spiel_nr` of every bracket fixture whose sides the result entry
    resolved — a semi-final that gained its winner, and, when a result was corrected, a later fixture
    that lost an occupant it should never have had (ADR-0042). It reports what happened rather than
    what was asked for, so it names a fixture that was emptied as readily as one that was filled.

    Reported for the same reason `PATCH /teams/{team_id}` reports `fanned_out_to_spiele`: a write that
    silently changes documents the caller did not name is one whose failures are invisible. An empty
    list is the ordinary answer for a group-phase edit.

    `unresolvable_slots` carries the bracket slots whose `gruppe` reference cannot be honoured and will
    not become honourable by waiting (ADR-0043). A group still being played is not in it: a placing that
    is not decided yet is the ordinary state and needs nobody.
    """

    advanced_to: list[int] = Field(default_factory=list)
    unresolvable_slots: list[FLUnresolvableSlot] = Field(default_factory=list)
