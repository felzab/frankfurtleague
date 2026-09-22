from typing import Literal

from pydantic import BaseModel, ConfigDict

# The application's slice is where the delivery vocabulary was first written, and a second spelling
# of the six states would let two homes disagree about what a bounce is called.
from app.api.bewerbungen.schemas import CustomNachrichtId, CustomZustellgrund, CustomZustellzeitpunkt, FLBewerbungZustellEreignis
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.responses import BaseAPIResponse

# A member joins this set in the commit that gives it an `app/api/zustellung/services.py ::
# ZIEL_PFADE` row and its own validator block: one arriving without either names a kind every
# write reaches nothing through.
FLZustellungZiel = Literal["schiedsrichter", "einladung", "registrierung"]


class _ZielMeldung(BaseModel):
    """What every write names: the kind of record, the row itself, and when."""

    model_config = ConfigDict(extra="forbid")

    ziel: FLZustellungZiel
    # Beside the kind, which names a population: a report carrying `ziel` alone reaches whichever
    # row a later reader guesses at. In the BODY, as the application's twin keeps its own id there,
    # the edge logging a path (`docs/logging/spec.md :: L9`).
    ziel_id: CustomObjectId
    am: CustomZustellzeitpunkt


class _ZielZustellungPayload(_ZielMeldung):
    """What the two writes about a minted message name, the message among them."""

    nachricht_id: CustomNachrichtId


class FLZustellungAngenommenPayload(_ZielZustellungPayload):
    """One message the provider accepted for this record. `stand` is not a key: this endpoint records `angenommen` and no other state."""


class FLZustellungAbgewiesenPayload(_ZielMeldung):
    """A send the provider refused outright. No `nachricht_id`: nothing was minted, so there is no message for a later event to join."""

    # Required as a KEY and null where the refusal names no token, as the event's twin requires it:
    # an omitted key would read as a client that forgot it rather than a refusal carrying none.
    grund: CustomZustellgrund


class FLZustellungEreignisPayload(_ZielZustellungPayload):
    """One delivery event about a message this record was sent."""

    stand: FLBewerbungZustellEreignis
    # Required as a KEY and null where the event carries none, as the application's twin requires
    # it: an omitted key would read as a client that forgot it rather than a bounce with no token.
    grund: CustomZustellgrund


class FLZustellungResponse(BaseAPIResponse):
    """Whether the write reached the record; false where the report is about a message the record does not hold.

    False rather than a refusal: the provider repeats a settled event for hours if anything but a
    success answers it.
    """

    angewendet: bool
