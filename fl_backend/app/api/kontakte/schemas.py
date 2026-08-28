from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints

from app.shared.schemas.bounds import KONTAKT_EMAIL_MAX_LENGTH
from app.shared.schemas.responses import BaseAPIResponse


class FLKontaktErasurePayload(BaseModel):
    """Which person is asking to be forgotten, named by the one field that joins their records.

    A contact block carries no id and nothing joins one season's Trainer to the next season's, so
    the address IS the identity here.
    """

    model_config = ConfigDict(extra="forbid")

    # In the BODY and on no path or query: an address in a path lands in the access log, in nginx's
    # log and in `aktionen.request.path`, three fresh copies of the value the request exists to destroy.
    email: Annotated[EmailStr, StringConstraints(max_length=KONTAKT_EMAIL_MAX_LENGTH)]


class FLKontaktErasureResponse(BaseAPIResponse):
    """What the erasure reached, and NOT an echo of the person.

    `app/api/spieler/schemas.py :: FLSpielerErasureResponse`'s reason, binding harder here: the
    request named an address, so echoing anything of theirs returns a copy of what was destroyed.
    """

    # Junction rows and applications whose block named them. Rows, not people: one row can hold the
    # same person twice.
    cleared_saison_teams: int = Field(ge=0)
    cleared_bewerbungen: int = Field(ge=0)
    # The slots actually nulled, across both collections. Higher than the two counts above ADDED
    # wherever `trainer_ist_ansprechperson` put one person in two slots of one row, which is what
    # makes this the figure showing the double-slot case was reached.
    cleared_kontakt_slots: int = Field(ge=0)
    # Log rows emptied and stamped (`docs/backend/spec.md :: I42`): those naming a row above, and
    # those still HOLDING the person where a swap moved them out of one. Disjoint, so nothing is
    # counted twice -- and no row is dropped, so never a deletion count.
    redacted_aktionen: int = Field(ge=0)
