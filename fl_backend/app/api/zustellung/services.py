from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from app.api.teams.schemas import KONTAKT_ROLLEN
from app.api.zustellung.schemas import ZIELE_JE_SITZ, FLZustellungZiel
from app.core.collections import Collection

# The key the record hangs under inside its carrier. Spelled once because the judges this slice
# shares read it off the carrier (`app/api/bewerbungen/services.py :: seat_zustellung`), so a second
# spelling here would judge one field and write another.
ZUSTELLUNG_FELD = "zustellung"


@dataclass(frozen=True)
class ZielPfad:
    """Where one kind of record's delivery state lives."""

    collection: Collection
    # The carrier rather than the whole dotted path: an absent carrier is a record nothing was
    # mailed about, which the accepted send tells from one holding nothing yet. A seat kind's is the
    # block of per-seat carriers.
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
    # A contact seat an administrator typed onto a team's season row: each seat's link entry is a
    # carrier, so two people on one row are two records and one message reaches every seat its person holds.
    "kontakt": ZielPfad(Collection.SAISON_TEAMS, "bestaetigungen"),
    # A confirmed referee's address link, which goes to the address the change names rather than to
    # the one the row holds: its own carrier, so its bounce never marks the consent link's message.
    "schiedsrichter_adresswechsel": ZielPfad(Collection.SCHIEDSRICHTER, "adresswechsel"),
}


# `unzustellbar` of the three states the clocks skip on: the other two are a suppression list and a
# recipient's complaint, which a provider reports about a message it took rather than about one it
# turned away.
ABGEWIESENER_VERSAND_STAND = "unzustellbar"


def traeger_pfade(ziel: FLZustellungZiel, rollen: Sequence[str]) -> list[str]:
    """The dotted path of every carrier one report reaches: the row's one carrier, or each named seat's, once and in declaration order."""

    pfad = ZIEL_PFADE[ziel]
    if ziel not in ZIELE_JE_SITZ:
        return [pfad.traeger]

    return [f"{pfad.traeger}.{sitz}" for sitz in KONTAKT_ROLLEN if sitz in rollen]


def traeger_halter(raw: Mapping[str, Any], traeger: str) -> tuple[Any, str]:
    """The mapping a carrier sits in, and its key there, which is the pair the shared judges read a seat's entry by."""

    *aussen, schluessel = traeger.split(".")
    halter: Any = raw
    for teil in aussen:
        halter = halter.get(teil) if isinstance(halter, Mapping) else None

    return halter, schluessel


def zustellung_pfad(traeger: str) -> str:
    return f"{traeger}.{ZUSTELLUNG_FELD}"


def zustellung_projektion(traeger: Sequence[str]) -> Mapping[str, int]:
    """The delivery states alone: a carrier holds a person's own bookkeeping beside it, and none of it decides anything here."""

    return {zustellung_pfad(pfad): 1 for pfad in traeger}


def compose_ziel_zustellung_update(*, traeger: Sequence[str], nachricht_id: str, stand: str, grund: str | None, am: str) -> Mapping[str, Any]:
    """The whole record per carrier, never a field of it: a state carrying another message's `grund` reads as a refusal that never happened."""

    record = {"nachricht_id": nachricht_id, "stand": stand, "grund": grund, "am": am}

    return {"$set": {zustellung_pfad(pfad): dict(record) for pfad in traeger}}
