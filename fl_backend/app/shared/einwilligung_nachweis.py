"""
SHARED · the evidence each consent choice keeps, and the one way a writer composes it

Art. 7(1) DSGVO puts the proof of a consent on the league. Each choice a person makes on their
record, `umfang` and `medien`, keeps when they set it and under which wording, and a withdrawal keeps
the grant it ended: proof for as long as the record stands, bounded at one act per choice.

Invariants:
- Only the person's own write stamps evidence: no administrative write sets a choice.
- A choice and its evidence move in one update, never one without the other.

See: docs/glossary.md
"""

from collections.abc import Mapping
from typing import Any, Final, Literal

NACHWEIS: Final = "nachweis"
ERTEILT_ZUVOR: Final = "erteilt_zuvor"

FLEinwilligungWahl = Literal["umfang", "medien"]
WAHLEN: Final[tuple[FLEinwilligungWahl, ...]] = ("umfang", "medien")

# The values that GRANT, across both vocabularies; every other value of a choice withholds. A
# contact seat's `kontaktdaten` is the acknowledgement alone, and WhatsApp the consent on top of it.
_ERTEILEND: Final[Mapping[str, tuple[object, ...]]] = {"umfang": ("kader_oeffentlich", "kontaktdaten_whatsapp"), "medien": (True,)}


def ist_erteilt(wahl: FLEinwilligungWahl, wert: Any) -> bool:
    """Whether this value of the choice grants; an absent value (`None`) never does."""

    return any(wert is erteilend or (isinstance(erteilend, str) and wert == erteilend) for erteilend in _ERTEILEND[wahl])


def compose_beleg(*, gespeichert: Mapping[str, Any], wahl: FLEinwilligungWahl, wert: Any, am: str, text_version: str) -> dict[str, Any]:
    """The evidence a choice set to `wert` keeps, `gespeichert` being the block as it stood before the act."""

    beleg: dict[str, Any] = {"am": am, "text_version": text_version}
    if ist_erteilt(wahl, wert):
        return beleg

    nachweise = gespeichert.get(NACHWEIS)
    zuvor = nachweise.get(wahl) if isinstance(nachweise, Mapping) else None
    if not isinstance(zuvor, Mapping):
        # A grant stored before evidence was kept leaves nothing to name: the withdrawal stands alone.
        return beleg

    if ist_erteilt(wahl, gespeichert.get(wahl)):
        beleg[ERTEILT_ZUVOR] = {"am": zuvor["am"], "text_version": zuvor["text_version"]}
    elif isinstance(zuvor.get(ERTEILT_ZUVOR), Mapping):
        # A withdrawal restated keeps the grant the first one ended.
        beleg[ERTEILT_ZUVOR] = dict(zuvor[ERTEILT_ZUVOR])

    return beleg


def compose_wahlen(
    *, pfad: str, gespeichert: Mapping[str, Any], gesetzt: Mapping[FLEinwilligungWahl, Any], am: str, text_version: str
) -> dict[str, Any]:
    """The dotted `$set` moving these choices and their evidence on the block at `pfad`, read in the writer's transaction.

    Never the block whole: its provenance and its other choice's evidence are the record's, not this act's.
    """

    gesetzt_set: dict[str, Any] = {}
    for wahl, wert in gesetzt.items():
        gesetzt_set[f"{pfad}.{wahl}"] = wert
        gesetzt_set[f"{pfad}.{NACHWEIS}.{wahl}"] = compose_beleg(
            gespeichert=gespeichert, wahl=wahl, wert=wert, am=am, text_version=text_version
        )

    return gesetzt_set


def compose_geboren(*, block: Mapping[str, Any], am: str) -> dict[str, Any]:
    """A block its person's own confirmation writes whole, each choice it holds evidenced under the block's label."""

    if NACHWEIS in block or not isinstance(block.get("text_version"), str) or not block["text_version"]:
        raise ValueError("a block being born carries no evidence of its own, and needs the label its person was shown")

    nachweis = {
        wahl: compose_beleg(gespeichert={}, wahl=wahl, wert=block[wahl], am=am, text_version=block["text_version"])
        for wahl in WAHLEN
        if wahl in block
    }

    return {**block, NACHWEIS: nachweis}
