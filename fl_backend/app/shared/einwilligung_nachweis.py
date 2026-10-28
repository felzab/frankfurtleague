"""
SHARED · the evidence each consent choice keeps, and the one way a writer composes it

Art. 7(1) DSGVO puts the proof of a consent on the league. Each choice a person makes on their
record, `umfang` and `medien`, keeps when they set it and under which wording, and a withdrawal keeps
the grant it ended: proof for as long as the record stands, bounded at one act per choice.

Invariants:
- Only the person's own writes grant a choice or stamp its evidence, an admission renewing from their own
  registration and a restore replaying their journalled withdrawal among them; no administrative write does.
- A choice and its evidence move in one update, never one without the other.

See: docs/glossary.md
"""

import hashlib
import json
from collections.abc import Mapping, Sequence
from datetime import datetime
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

    if ist_erteilt(wahl, gespeichert.get(wahl)):
        # The grant this withdrawal ends, read as the renewal reads it.
        zuvor = beleg_of(gespeichert, wahl)
        if zuvor is not None:
            beleg[ERTEILT_ZUVOR] = zuvor[1]
        return beleg

    nachweise = gespeichert.get(NACHWEIS)
    stehend = nachweise.get(wahl) if isinstance(nachweise, Mapping) else None
    if isinstance(stehend, Mapping) and isinstance(stehend.get(ERTEILT_ZUVOR), Mapping):
        # A withdrawal restated keeps the grant the first one ended.
        beleg[ERTEILT_ZUVOR] = dict(stehend[ERTEILT_ZUVOR])

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


def _nachweis_of(block: Mapping[str, Any], wahl: FLEinwilligungWahl) -> Mapping[str, Any] | None:
    nachweise = block.get(NACHWEIS)
    beleg = nachweise.get(wahl) if isinstance(nachweise, Mapping) else None

    return beleg if isinstance(beleg, Mapping) else None


def _am_of(block: Mapping[str, Any], wahl: FLEinwilligungWahl) -> datetime | None:
    nachweise = block.get(NACHWEIS)
    beleg = nachweise.get(wahl) if isinstance(nachweise, Mapping) else None

    return datetime.fromisoformat(beleg["am"]) if isinstance(beleg, Mapping) and isinstance(beleg.get("am"), str) else None


def nachweis_stand_of(*, bloecke: Sequence[Any]) -> dict[str, str | None]:
    """Per choice, a digest of each block's value and evidence; null where none carries evidence.

    Never the evidence's instant, stamped to the second: a page served between two acts in one second
    would re-grant what the second withdrew.
    """

    stand: dict[str, str | None] = {}
    # Every choice, never a subset: a press moves both, so a stand over one would let the other move unseen.
    for wahl in WAHLEN:
        gesetzt = [[block.get(wahl), _nachweis_of(block, wahl)] for block in bloecke if isinstance(block, Mapping)]
        if all(beleg is None for _, beleg in gesetzt):
            stand[wahl] = None
            continue
        # Sorted keys and `sha256`, as `app/api/teams/schemas.py :: kontakte_stand_of` digests a block.
        canonical = json.dumps(gesetzt, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
        stand[wahl] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    return stand


def beleg_of(block: Mapping[str, Any], wahl: FLEinwilligungWahl) -> tuple[datetime, dict[str, str]] | None:
    """When a block's choice was set, and its evidence; `None` where no evidence says, its person never having set it."""

    am = _am_of(block, wahl)
    if am is None:
        return None

    beleg = block[NACHWEIS][wahl]

    return am, {"am": beleg["am"], "text_version": beleg["text_version"]}


def compose_erneuert(*, pfad: str, gespeichert: Mapping[str, Any], erneuert: Mapping[str, Any]) -> dict[str, Any]:
    """The dotted `$set` renewing the block at `pfad` from `erneuert`, the same person's later answers.

    A choice moves only where it was set there later, and only with evidence to carry.
    """

    # The day and the label, `datum` with them, only from a confirmation no older than the stored one:
    # an older registration admitted after a newer one would date and name the record backwards.
    neu_am, alt_am = erneuert.get("bestaetigt_am"), gespeichert.get("bestaetigt_am")
    juenger = not (isinstance(alt_am, str) and alt_am) or (isinstance(neu_am, str) and neu_am >= alt_am)
    gesetzt: dict[str, Any] = (
        {f"{pfad}.{field}": value for field, value in erneuert.items() if field not in (*WAHLEN, NACHWEIS)} if juenger else {}
    )
    for wahl in WAHLEN:
        neu, alt = beleg_of(erneuert, wahl), beleg_of(gespeichert, wahl)
        if wahl not in erneuert or neu is None or (alt is not None and neu[0] <= alt[0]):
            continue

        gesetzt[f"{pfad}.{wahl}"] = erneuert[wahl]
        # Judged against the stored block, so a withdrawal names the grant it ended there.
        gesetzt[f"{pfad}.{NACHWEIS}.{wahl}"] = compose_beleg(
            gespeichert=gespeichert, wahl=wahl, wert=erneuert[wahl], am=neu[1]["am"], text_version=neu[1]["text_version"]
        )

    return gesetzt


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
