from typing import Literal

from pydantic import BaseModel

# What became of the last message to one seat's address. `angenommen` is the provider ACCEPTING the
# request, which is all a send ever learns; the five after it are what a delivery event reports.
FLBewerbungZustellstand = Literal["angenommen", "zugestellt", "verzoegert", "unzustellbar", "unterdrueckt", "beschwerde"]


class FLBewerbungZustellung(BaseModel):
    """What became of the last message to one seat.

    Inside the seat's block rather than a collection of its own: an erasure empties that block, so
    this goes with the person it is about.
    """

    # The join key: an event naming another message is about a link the seat does not hold, so a
    # superseded message's bounce cannot mark the fresh one.
    nachricht_id: str
    stand: FLBewerbungZustellstand
    # The provider's own token, never its prose: a bounce message quotes the recipient's address
    # (`docs/logging/spec.md :: L9`), and the German is composed at the surface.
    grund: str | None
    # A PLAIN string here where the payload normalises, as `FLBewerbungSchule.website_url` is: this
    # model reads stored values, and refusing one would 500 the whole triage list.
    am: str
