"""
API · the one sequence every consent press on the account page runs between finding its record and writing it

One sequence for every kind, so no two presses judge one press in two orders: the stale page first, then a
grant the record may not take, then the media age; the labels are the payload's schema's to refuse. The handler
finds its record before and writes the move after, a write by the id it read in the same transaction never missing.

Invariants:
- A press refused at any step writes nothing.
"""

from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Any

from app.api.account.services import erteilt_etwas, find_erteilung_refusal, find_nachweis_stand_refusal
from app.api.einwilligung.services import find_self_medien_refusal
from app.core.crud import refuse
from app.shared.einwilligung_nachweis import FLEinwilligungChoice, is_given

# Whether the record the press found may take a grant, asked only of a press granting something: the
# read behind it is the Funktion lookup, and a withdrawal needs none.
DarfErteilen = Callable[[], Awaitable[bool]]


async def _vor_der_erteilung(
    *,
    bloecke: Sequence[Mapping[str, Any]],
    gewaehlt: Mapping[FLEinwilligungChoice, Any],
    nachweis_stand: Mapping[str, Any],
    darf_erteilen: DarfErteilen | None,
) -> bool:
    """The steps every kind shares, the stale page and a grant the record may not take; whether the press grants."""

    refuse(find_nachweis_stand_refusal(erwartet=nachweis_stand, bloecke=bloecke))

    erteilt = any(erteilt_etwas(gespeichert=block, gewaehlt=gewaehlt) for block in bloecke)
    if erteilt:
        refuse(find_erteilung_refusal(zugelassen=darf_erteilen is not None and await darf_erteilen()))

    return erteilt


async def press_einwilligung(
    *,
    bloecke: Sequence[Mapping[str, Any]],
    geburtsdaten: Sequence[Any],
    gewaehlt: Mapping[FLEinwilligungChoice, Any],
    nachweis_stand: Mapping[str, Any],
    darf_erteilen: DarfErteilen,
    today: str,
) -> None:
    """A press on a kind that takes grants, refused where a step refuses it, leaving the write to the handler.

    `bloecke` are the consent blocks the press moves, each beside its person's stored birthdate in `geburtsdaten`.
    """

    await _vor_der_erteilung(
        bloecke=bloecke,
        gewaehlt=gewaehlt,
        nachweis_stand=nachweis_stand,
        darf_erteilen=darf_erteilen,
    )
    medien = is_given("medien", gewaehlt.get("medien"))
    for block, geburtsdatum in zip(bloecke, geburtsdaten, strict=True):
        refuse(find_self_medien_refusal(gespeichert=block, medien=medien, geburtsdatum=geburtsdatum, today=today))


async def press_widerruf(
    *,
    bloecke: Sequence[Mapping[str, Any]],
    gewaehlt: Mapping[FLEinwilligungChoice, Any],
    nachweis_stand: Mapping[str, Any],
) -> None:
    """A press on a kind taking withdrawals alone: every grant refused before any rule only a grant meets, and nothing counted."""

    await _vor_der_erteilung(
        bloecke=bloecke,
        gewaehlt=gewaehlt,
        nachweis_stand=nachweis_stand,
        darf_erteilen=None,
    )
