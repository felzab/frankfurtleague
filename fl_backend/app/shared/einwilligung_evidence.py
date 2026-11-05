"""
SHARED · the evidence each consent choice keeps, and the one way a writer composes it

Art. 7(1) DSGVO puts the proof of a consent on the league. Each choice a person makes on their
record, `umfang` and `media`, keeps when they set it and under which wording, and a withdrawal keeps
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

EVIDENCE: Final = "evidence"
GIVEN_BEFORE: Final = "given_before"

FLEinwilligungChoice = Literal["umfang", "media"]
CHOICES: Final[tuple[FLEinwilligungChoice, ...]] = ("umfang", "media")

# The label of the wording each choice was given under, as a press's `text_versions` names them: the two choices of
# one press stand beside two wordings.
type TextVersions = Mapping[FLEinwilligungChoice, str]

# The values that GRANT, across both vocabularies; every other value of a choice withholds. A
# contact seat's `kontaktdaten` is the acknowledgement alone, and WhatsApp the consent on top of it.
_GIVING: Final[Mapping[str, tuple[object, ...]]] = {"umfang": ("kader_oeffentlich", "kontaktdaten_whatsapp"), "media": (True,)}


def is_given(choice: FLEinwilligungChoice, value: Any) -> bool:
    """Whether this value of the choice grants; an absent value (`None`) never does."""

    return any(value is giving or (isinstance(giving, str) and value == giving) for giving in _GIVING[choice])


def compose_receipt(*, saved: Mapping[str, Any], choice: FLEinwilligungChoice, value: Any, at: str, text_version: str) -> dict[str, Any]:
    """The evidence a choice set to `value` keeps, `saved` being the block as it stood before the act."""

    receipt: dict[str, Any] = {"at": at, "text_version": text_version}
    if is_given(choice, value):
        return receipt

    if is_given(choice, saved.get(choice)):
        # The grant this withdrawal ends, read as the renewal reads it.
        before = receipt_of(saved, choice)
        if before is not None:
            receipt[GIVEN_BEFORE] = before[1]
        return receipt

    evidence_set = saved.get(EVIDENCE)
    standing = evidence_set.get(choice) if isinstance(evidence_set, Mapping) else None
    if isinstance(standing, Mapping) and isinstance(standing.get(GIVEN_BEFORE), Mapping):
        # A withdrawal restated keeps the grant the first one ended.
        receipt[GIVEN_BEFORE] = dict(standing[GIVEN_BEFORE])

    return receipt


def compose_choices(
    *, path: str, saved: Mapping[str, Any], set_fields: Mapping[FLEinwilligungChoice, Any], at: str, text_versions: TextVersions
) -> dict[str, Any]:
    """The dotted `$set` moving these choices and their evidence on the block at `path`, read in the writer's transaction.

    Never the block whole: its provenance and its other choice's evidence are the record's, not this act's.
    """

    set_document: dict[str, Any] = {}
    for choice, value in set_fields.items():
        set_document[f"{path}.{choice}"] = value
        set_document[f"{path}.{EVIDENCE}.{choice}"] = compose_receipt(
            saved=saved, choice=choice, value=value, at=at, text_version=text_versions[choice]
        )

    return set_document


def _evidence_of(block: Mapping[str, Any], choice: FLEinwilligungChoice) -> Mapping[str, Any] | None:
    evidence_set = block.get(EVIDENCE)
    receipt = evidence_set.get(choice) if isinstance(evidence_set, Mapping) else None

    return receipt if isinstance(receipt, Mapping) else None


def _at_of(block: Mapping[str, Any], choice: FLEinwilligungChoice) -> datetime | None:
    evidence_set = block.get(EVIDENCE)
    receipt = evidence_set.get(choice) if isinstance(evidence_set, Mapping) else None

    return datetime.fromisoformat(receipt["at"]) if isinstance(receipt, Mapping) and isinstance(receipt.get("at"), str) else None


def evidence_state_of(*, blocks: Sequence[Any]) -> dict[str, str | None]:
    """Per choice, a digest of each block's value and evidence; null where none carries evidence.

    Never the evidence's instant, stamped to the second: a page served between two acts in one second
    would re-grant what the second withdrew.
    """

    stand: dict[str, str | None] = {}
    # Every choice, never a subset: a press moves both, so a stand over one would let the other move unseen.
    for choice in CHOICES:
        set_fields = [[block.get(choice), _evidence_of(block, choice)] for block in blocks if isinstance(block, Mapping)]
        if all(receipt is None for _, receipt in set_fields):
            stand[choice] = None
            continue
        # Sorted keys and `sha256`, as `app/api/teams/schemas.py :: kontakte_stand_of` digests a block.
        canonical = json.dumps(set_fields, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
        stand[choice] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    return stand


def receipt_of(block: Mapping[str, Any], choice: FLEinwilligungChoice) -> tuple[datetime, dict[str, str]] | None:
    """When a block's choice was set, and its evidence; `None` where no evidence says, its person never having set it."""

    at = _at_of(block, choice)
    if at is None:
        return None

    receipt = block[EVIDENCE][choice]

    return at, {"at": receipt["at"], "text_version": receipt["text_version"]}


def compose_renewed(*, path: str, saved: Mapping[str, Any], renewed: Mapping[str, Any]) -> dict[str, Any]:
    """The dotted `$set` renewing the block at `path` from `renewed`, the same person's later answers.

    A choice moves only where it was set there later, and only with evidence to carry.
    """

    # The confirmation's day, `datum` with it, only from a confirmation no older than the stored one:
    # an older registration admitted after a newer one would date the record backwards.
    new_at, old_at = renewed.get("confirmed_at"), saved.get("confirmed_at")
    younger = not (isinstance(old_at, str) and old_at) or (isinstance(new_at, str) and new_at >= old_at)
    set_fields: dict[str, Any] = (
        {f"{path}.{field}": value for field, value in renewed.items() if field not in (*CHOICES, EVIDENCE)} if younger else {}
    )
    for choice in CHOICES:
        new, old = receipt_of(renewed, choice), receipt_of(saved, choice)
        if choice not in renewed or new is None or (old is not None and new[0] <= old[0]):
            continue

        set_fields[f"{path}.{choice}"] = renewed[choice]
        # Judged against the stored block, so a withdrawal names the grant it ended there.
        set_fields[f"{path}.{EVIDENCE}.{choice}"] = compose_receipt(
            saved=saved, choice=choice, value=renewed[choice], at=new[1]["at"], text_version=new[1]["text_version"]
        )

    return set_fields


def compose_born(*, block: Mapping[str, Any], at: str, text_versions: TextVersions) -> dict[str, Any]:
    """A block its person's own confirmation writes whole, each choice it holds evidenced under that choice's label."""

    if EVIDENCE in block:
        raise ValueError("a block being born carries no evidence of its own")

    evidence = {
        choice: compose_receipt(saved={}, choice=choice, value=block[choice], at=at, text_version=text_versions[choice])
        for choice in CHOICES
        if choice in block
    }

    return {**block, EVIDENCE: evidence}
