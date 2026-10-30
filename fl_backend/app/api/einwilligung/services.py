import re
from collections.abc import Mapping
from http import HTTPStatus
from types import MappingProxyType
from typing import Any, Final

from app.api.einwilligung.schemas import FLEinwilligungWording
from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from app.shared.alter import whole_years_between
from app.shared.einwilligung import FASSUNGEN, LAUFENDE_FASSUNGEN, Fassung, Seite
from app.shared.einwilligung_nachweis import is_given
from app.shared.schemas.bounds import MEDIEN_MIN_AGE_YEARS

# The reader's own facts inside the words, spelled `{name}` in every label.
_PLATZHALTER: Final = re.compile(r"\{([A-Za-z]+)\}")


def find_fassung_refusal(
    *,
    seite: Seite,
    named: Mapping[str, str],
    gehalten: Mapping[str, str | None] = MappingProxyType({}),
    jede_fassung: bool = False,
) -> WriteRefusal | None:
    """Why a write may not stamp the labels it names, keyed by where each is stamped, or `None`.

    A new acceptance names the running label: a page loaded before a deploy moved it shows words the
    record would then cite.
    """

    laufend = LAUFENDE_FASSUNGEN[seite]
    abgewiesen = [
        ort
        for ort, label in named.items()
        if label != laufend
        # A withdrawal may name any version of its page: taking a consent back is never harder than giving it.
        and not (jede_fassung and _version_of(label, seite=seite))
        # Keyed by the places whose PERSON the write leaves unchanged, whichever page the label is a
        # version of: that record is carried, not stamped.
        and not (label is not None and label == gehalten.get(ort))
    ]

    if abgewiesen:
        return WriteRefusal(
            error_code=Code.WORDING_NOT_ALLOWED,
            status=HTTPStatus.CONFLICT,
        )

    return None


def _version_of(label: str, *, seite: Seite) -> bool:
    fassung = FASSUNGEN.get(label)

    return fassung is not None and fassung.seite == seite


def medien_angeboten(*, geburtsdatum: Any, today: str) -> bool:
    """Whether this person may switch the media consent on: their birthdate reaches `MEDIEN_MIN_AGE_YEARS` today.

    Fails CLOSED on a null or unreadable date.
    """

    if not isinstance(geburtsdatum, str):
        return False

    try:
        return whole_years_between(born=geburtsdatum, today=today) >= MEDIEN_MIN_AGE_YEARS
    except ValueError:
        return False


def find_self_medien_refusal(*, gespeichert: Any, medien: bool, geburtsdatum: Any, today: str) -> WriteRefusal | None:
    """Why a media consent moving to `true` is refused, judged on the birthdate the write leaves.

    Only a move off the stored block is judged, so a resent `true` never blocks the other switch; a
    confirmation passes `None`.
    """

    stand_erteilt = isinstance(gespeichert, Mapping) and is_given("medien", gespeichert.get("medien"))
    if not medien or stand_erteilt or medien_angeboten(geburtsdatum=geburtsdatum, today=today):
        return None

    return WriteRefusal(
        error_code=Code.MEDIEN_AGE,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        fields=(("medien",),),
    )


def served_fassung(text_version: str, wording: Fassung) -> FLEinwilligungWording:
    """One label as the words read serves it."""

    texts = (*wording.absaetze, wording.switch, *wording.controls.values())

    return FLEinwilligungWording(
        text_version=text_version,
        seite=wording.seite,
        applies_from=wording.applies_from.isoformat(),
        absaetze=list(wording.absaetze),
        switch=wording.switch,
        controls=dict(wording.controls),
        absaetze_nach_schluessel=None if wording.absaetze_nach_schluessel is None else dict(wording.absaetze_nach_schluessel),
        placeholder=sorted({name for text in texts for name in _PLATZHALTER.findall(text)}),
    )
