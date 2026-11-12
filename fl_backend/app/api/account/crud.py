"""Every consent press runs this one sequence between finding its record and writing it, a refusal at any step writing nothing.

One sequence for every kind, so no two presses judge in two orders: the stale page first, then a grant the record may
not take, then a grant under a replaced label, then the media age.
"""

from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Any

from app.api.account.services import find_evidence_state_refusal, find_giving_refusal, find_grant_wording_refusal, gives_anything
from app.api.einwilligung.services import find_self_media_refusal
from app.core.crud import refuse
from app.shared.einwilligung_evidence import FLEinwilligungChoice, is_given
from app.shared.schemas.einwilligung import PressTextVersions

# Whether the record the press found may take a grant, asked only of a press granting something: the
# read behind it is the Funktion lookup, and a withdrawal needs none.
MayGive = Callable[[], Awaitable[bool]]


async def may_always_give() -> bool:
    """`MayGive` of a record no state of which refuses a grant: a pupil's, whose every confirmed record stands live."""

    return True


async def _before_giving(
    *,
    blocks: Sequence[Mapping[str, Any]],
    chosen: Mapping[FLEinwilligungChoice, Any],
    evidence_state: Mapping[str, Any],
    may_give: MayGive | None,
) -> bool:
    """The steps every kind shares, the stale page and a grant the record may not take; whether the press grants."""

    refuse(find_evidence_state_refusal(expected=evidence_state, blocks=blocks))

    given = any(gives_anything(saved=block, chosen=chosen) for block in blocks)
    if given:
        refuse(find_giving_refusal(allowed=may_give is not None and await may_give()))

    return given


async def press_einwilligung(
    *,
    blocks: Sequence[Mapping[str, Any]],
    birth_dates: Sequence[Any],
    chosen: Mapping[FLEinwilligungChoice, Any],
    evidence_state: Mapping[str, Any],
    text_versions: PressTextVersions,
    may_give: MayGive,
    today: str,
) -> None:
    """A press on a kind that takes grants, refused where a step refuses it, leaving the write to the handler.

    `blocks` are the consent blocks the press moves, each beside its person's stored birthdate in `birth_dates`.
    """

    await _before_giving(
        blocks=blocks,
        chosen=chosen,
        evidence_state=evidence_state,
        may_give=may_give,
    )
    refuse(find_grant_wording_refusal(blocks=blocks, chosen=chosen, text_versions=text_versions))
    media = is_given("media", chosen.get("media"))
    for block, birth_date in zip(blocks, birth_dates, strict=True):
        refuse(find_self_media_refusal(saved=block, media=media, birth_date=birth_date, today=today))


async def press_withdrawal(
    *,
    blocks: Sequence[Mapping[str, Any]],
    chosen: Mapping[FLEinwilligungChoice, Any],
    evidence_state: Mapping[str, Any],
) -> None:
    """A press on a kind taking withdrawals alone: every grant refused before any rule only a grant meets, and nothing counted.

    No label is judged: a withdrawal names any its kind cites.
    """

    await _before_giving(
        blocks=blocks,
        chosen=chosen,
        evidence_state=evidence_state,
        may_give=None,
    )
