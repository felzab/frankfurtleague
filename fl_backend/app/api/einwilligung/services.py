import re
from collections.abc import Mapping
from http import HTTPStatus
from types import MappingProxyType
from typing import Final

from app.api.einwilligung.schemas import FLEinwilligungFassung
from app.core.exceptions import WriteRefusal
from app.shared.einwilligung import FASSUNGEN, LAUFENDE_FASSUNGEN, Fassung, Seite

# What the code refuses is `fl_backend/app/core/domain.py :: RULES`. One code for every write that
# stamps a label, so a page's form maps one refusal however many writes share its page.
FASSUNG_UNZULAESSIG = "REQ-EINWILLIGUNG-001"

# The reader's own facts inside the words, spelled `{name}` in every label.
_PLATZHALTER: Final = re.compile(r"\{([A-Za-z]+)\}")


def find_fassung_refusal(
    *, seite: Seite, genannt: Mapping[str, str], gespeichert: Mapping[str, str | None] = MappingProxyType({})
) -> WriteRefusal | None:
    """Why a write may not stamp the labels it names, keyed by where each is stamped, or `None`.

    A new acceptance names the running label: a page loaded before a deploy moved it shows words the
    record would then cite.
    """

    laufend = LAUFENDE_FASSUNGEN[seite]
    # A place keeps the label it already holds, so an administrator's save over a seat confirmed
    # under an earlier wording is not refused; only while that label is a version of this page.
    abgewiesen = [
        ort for ort, label in genannt.items() if label != laufend and not (label == gespeichert.get(ort) and _version_of(label, seite=seite))
    ]

    if abgewiesen:
        return WriteRefusal(
            error_code=FASSUNG_UNZULAESSIG,
            status=HTTPStatus.CONFLICT,
            message=f"the consent wording named on {', '.join(abgewiesen)} is not one this page stores now; reload the page and submit again",
        )

    return None


def _version_of(label: str, *, seite: Seite) -> bool:
    fassung = FASSUNGEN.get(label)

    return fassung is not None and fassung.seite == seite


def served_fassung(text_version: str, fassung: Fassung) -> FLEinwilligungFassung:
    """One label as the words read serves it, and as `fl_backend/einwilligung.json` records it."""

    texts = (*fassung.absaetze, fassung.schalter, *fassung.bedienelemente.values())

    return FLEinwilligungFassung(
        text_version=text_version,
        seite=fassung.seite,
        gilt_ab=fassung.gilt_ab.isoformat(),
        absaetze=list(fassung.absaetze),
        schalter=fassung.schalter,
        bedienelemente=dict(fassung.bedienelemente),
        absaetze_nach_schluessel=None if fassung.absaetze_nach_schluessel is None else dict(fassung.absaetze_nach_schluessel),
        platzhalter=sorted({name for text in texts for name in _PLATZHALTER.findall(text)}),
    )
