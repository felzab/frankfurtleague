import re
from collections.abc import Mapping
from http import HTTPStatus
from types import MappingProxyType
from typing import Any, Final

from app.api.einwilligung.schemas import FLEinwilligungFassung
from app.core.exceptions import WriteRefusal
from app.shared.alter import whole_years_between
from app.shared.einwilligung import FASSUNGEN, LAUFENDE_FASSUNGEN, Fassung, Seite
from app.shared.schemas.bounds import MEDIEN_MIN_AGE_YEARS

# What the code refuses is `fl_backend/app/core/domain.py :: RULES`. One code for every write that
# stamps a label, so a page's form maps one refusal however many writes share its page.
FASSUNG_UNZULAESSIG = "REQ-EINWILLIGUNG-001"

# One code for every write taking a person's media consent, the account presses and the contact
# confirmation alike, so each page maps one refusal.
SELBST_MEDIEN_ALTER = "REQ-EINWILLIGUNG-002"

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


def medien_angeboten(*, geburtsdatum: Any, today: str) -> bool:
    """Whether this person may switch the media consent on: their birthdate reaches `MEDIEN_MIN_AGE_YEARS` today.

    Fails CLOSED on a null or unreadable date (`docs/backend/spec.md :: I338`).
    """

    if not isinstance(geburtsdatum, str):
        return False

    try:
        return whole_years_between(born=geburtsdatum, today=today) >= MEDIEN_MIN_AGE_YEARS
    except ValueError:
        return False


def find_selbst_medien_refusal(*, geburtsdatum: Any, medien_erteilt: bool, today: str) -> WriteRefusal | None:
    """Why a media consent moving to `true` is refused, judged on the birthdate the write leaves.

    Only a move is judged: a stored `true` resent beside the other switch grants nothing, and refusing
    it would block that switch.
    """

    if not medien_erteilt or medien_angeboten(geburtsdatum=geburtsdatum, today=today):
        return None

    return WriteRefusal(
        error_code=SELBST_MEDIEN_ALTER,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        fields=(("medien",),),
        message=(
            f"a consent to publishing photographs, video and interviews is given from {MEDIEN_MIN_AGE_YEARS} years of age only, "
            "judged on the birthdate the record holds once this write lands"
        ),
    )


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
