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
GIVEN_BEFORE: Final = "given_before"

FLEinwilligungChoice = Literal["umfang", "medien"]
CHOICES: Final[tuple[FLEinwilligungChoice, ...]] = ("umfang", "medien")

# The values that GRANT, across both vocabularies; every other value of a choice withholds. A
# contact seat's `kontaktdaten` is the acknowledgement alone, and WhatsApp the consent on top of it.
_GIVING: Final[Mapping[str, tuple[object, ...]]] = {"umfang": ("kader_oeffentlich", "kontaktdaten_whatsapp"), "medien": (True,)}


def is_given(choice: FLEinwilligungChoice, value: Any) -> bool:
    """Whether this value of the choice grants; an absent value (`None`) never does."""

    return any(value is giving or (isinstance(giving, str) and value == giving) for giving in _GIVING[choice])


def compose_beleg(*, saved: Mapping[str, Any], choice: FLEinwilligungChoice, value: Any, am: str, text_version: str) -> dict[str, Any]:
    """The evidence a choice set to `value` keeps, `saved` being the block as it stood before the act."""

    beleg: dict[str, Any] = {"am": am, "text_version": text_version}
    if is_given(choice, value):
        return beleg

    if is_given(choice, saved.get(choice)):
        # The grant this withdrawal ends, read as the renewal reads it.
        before = beleg_of(saved, choice)
        if before is not None:
            beleg[GIVEN_BEFORE] = before[1]
        return beleg

    nachweise = saved.get(NACHWEIS)
    stehend = nachweise.get(choice) if isinstance(nachweise, Mapping) else None
    if isinstance(stehend, Mapping) and isinstance(stehend.get(GIVEN_BEFORE), Mapping):
        # A withdrawal restated keeps the grant the first one ended.
        beleg[GIVEN_BEFORE] = dict(stehend[GIVEN_BEFORE])

    return beleg


def compose_choices(
    *, path: str, saved: Mapping[str, Any], gesetzt: Mapping[FLEinwilligungChoice, Any], am: str, text_version: str
) -> dict[str, Any]:
    """The dotted `$set` moving these choices and their evidence on the block at `path`, read in the writer's transaction.

    Never the block whole: its provenance and its other choice's evidence are the record's, not this act's.
    """

    gesetzt_set: dict[str, Any] = {}
    for choice, value in gesetzt.items():
        gesetzt_set[f"{path}.{choice}"] = value
        gesetzt_set[f"{path}.{NACHWEIS}.{choice}"] = compose_beleg(saved=saved, choice=choice, value=value, am=am, text_version=text_version)

    return gesetzt_set


def _nachweis_of(block: Mapping[str, Any], choice: FLEinwilligungChoice) -> Mapping[str, Any] | None:
    nachweise = block.get(NACHWEIS)
    beleg = nachweise.get(choice) if isinstance(nachweise, Mapping) else None

    return beleg if isinstance(beleg, Mapping) else None


def _am_of(block: Mapping[str, Any], choice: FLEinwilligungChoice) -> datetime | None:
    nachweise = block.get(NACHWEIS)
    beleg = nachweise.get(choice) if isinstance(nachweise, Mapping) else None

    return datetime.fromisoformat(beleg["am"]) if isinstance(beleg, Mapping) and isinstance(beleg.get("am"), str) else None


def nachweis_stand_of(*, bloecke: Sequence[Any]) -> dict[str, str | None]:
    """Per choice, a digest of each block's value and evidence; null where none carries evidence.

    Never the evidence's instant, stamped to the second: a page served between two acts in one second
    would re-grant what the second withdrew.
    """

    stand: dict[str, str | None] = {}
    # Every choice, never a subset: a press moves both, so a stand over one would let the other move unseen.
    for choice in CHOICES:
        gesetzt = [[block.get(choice), _nachweis_of(block, choice)] for block in bloecke if isinstance(block, Mapping)]
        if all(beleg is None for _, beleg in gesetzt):
            stand[choice] = None
            continue
        # Sorted keys and `sha256`, as `app/api/teams/schemas.py :: kontakte_stand_of` digests a block.
        canonical = json.dumps(gesetzt, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
        stand[choice] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    return stand


def beleg_of(block: Mapping[str, Any], choice: FLEinwilligungChoice) -> tuple[datetime, dict[str, str]] | None:
    """When a block's choice was set, and its evidence; `None` where no evidence says, its person never having set it."""

    am = _am_of(block, choice)
    if am is None:
        return None

    beleg = block[NACHWEIS][choice]

    return am, {"am": beleg["am"], "text_version": beleg["text_version"]}


def compose_erneuert(*, path: str, saved: Mapping[str, Any], erneuert: Mapping[str, Any]) -> dict[str, Any]:
    """The dotted `$set` renewing the block at `path` from `erneuert`, the same person's later answers.

    A choice moves only where it was set there later, and only with evidence to carry.
    """

    # The day and the label, `datum` with them, only from a confirmation no older than the stored one:
    # an older registration admitted after a newer one would date and name the record backwards.
    new_at, alt_am = erneuert.get("confirmed_at"), saved.get("confirmed_at")
    younger = not (isinstance(alt_am, str) and alt_am) or (isinstance(new_at, str) and new_at >= alt_am)
    gesetzt: dict[str, Any] = (
        {f"{path}.{field}": value for field, value in erneuert.items() if field not in (*CHOICES, NACHWEIS)} if younger else {}
    )
    for choice in CHOICES:
        new, alt = beleg_of(erneuert, choice), beleg_of(saved, choice)
        if choice not in erneuert or new is None or (alt is not None and new[0] <= alt[0]):
            continue

        gesetzt[f"{path}.{choice}"] = erneuert[choice]
        # Judged against the stored block, so a withdrawal names the grant it ended there.
        gesetzt[f"{path}.{NACHWEIS}.{choice}"] = compose_beleg(
            saved=saved, choice=choice, value=erneuert[choice], am=new[1]["am"], text_version=new[1]["text_version"]
        )

    return gesetzt


def compose_geboren(*, block: Mapping[str, Any], am: str) -> dict[str, Any]:
    """A block its person's own confirmation writes whole, each choice it holds evidenced under the block's label."""

    if NACHWEIS in block or not isinstance(block.get("text_version"), str) or not block["text_version"]:
        raise ValueError("a block being born carries no evidence of its own, and needs the label its person was shown")

    nachweis = {
        choice: compose_beleg(saved={}, choice=choice, value=block[choice], am=am, text_version=block["text_version"])
        for choice in CHOICES
        if choice in block
    }

    return {**block, NACHWEIS: nachweis}
