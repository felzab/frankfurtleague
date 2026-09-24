from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from app.api.zustellung.schemas import FLZustellungZiel
from app.core.collections import Collection

# The key the record hangs under inside its carrier. Spelled once because the judges this slice
# shares read it off the carrier (`app/api/bewerbungen/services.py :: seat_zustellung`), so a second
# spelling here would judge one field and write another.
ZUSTELLUNG_FELD = "zustellung"


@dataclass(frozen=True)
class ZielPfad:
    """Where one kind of record's delivery state lives."""

    collection: Collection
    # The carrier rather than the whole dotted path: an absent carrier is a record nothing was ever
    # mailed about, which the accepted send has to tell from one holding nothing yet.
    traeger: str


# A `Collection` member per row and never a name spelled out: `app/core/collections.py` is the one
# declaration of what this database holds.
ZIEL_PFADE: Mapping[FLZustellungZiel, ZielPfad] = {
    "schiedsrichter": ZielPfad(Collection.SCHIEDSRICHTER, "bestaetigung"),
    # `versand` rather than `zustellung`: the carrier and the record inside it would otherwise be
    # `zustellung.zustellung`, which `zustellung_pfad` cannot spell.
    "einladung": ZielPfad(Collection.EINLADUNGEN, "versand"),
    # The confirmation bookkeeping, as a referee's is: the message this state is about is the link
    # mailed to the registration's own address, the payload's normalisation of what the pupil typed.
    "registrierung": ZielPfad(Collection.REGISTRIERUNGEN, "bestaetigung"),
}


# `unzustellbar` of the three states the clocks skip on: the other two are a suppression list and a
# recipient's complaint, which a provider reports about a message it took rather than about one it
# turned away.
ABGEWIESENER_VERSAND_STAND = "unzustellbar"


def zustellung_pfad(pfad: ZielPfad) -> str:
    """The dotted path this kind of record's delivery state sits at."""

    return f"{pfad.traeger}.{ZUSTELLUNG_FELD}"


def zustellung_projektion(pfad: ZielPfad) -> Mapping[str, int]:
    """The delivery state alone: the carrier holds a person's own bookkeeping beside it, and none of it decides anything here."""

    return {zustellung_pfad(pfad): 1}


def compose_ziel_zustellung_update(*, pfad: ZielPfad, nachricht_id: str, stand: str, grund: str | None, am: str) -> Mapping[str, Any]:
    """The whole record, never a field of it: a state carrying another message's `grund` reads as a refusal that never happened."""

    return {"$set": {zustellung_pfad(pfad): {"nachricht_id": nachricht_id, "stand": stand, "grund": grund, "am": am}}}
