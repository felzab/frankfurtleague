from pydantic import BaseModel

from app.shared.schemas.custom import CustomDateString
from app.shared.schemas.responses import BaseAPIResponse


class FLEinwilligungWording(BaseModel):
    """The words one consent label names, as the person stamping it was shown them.

    Never changed once served: different words are a new label.
    """

    text_version: str
    # Open rather than a closed set, so a page added to the registry moves no published schema.
    seite: str
    applies_from: CustomDateString
    absaetze: list[str]
    switch: str
    controls: dict[str, str]
    # The same words as `absaetze`, in the same order, keyed by section for a page placing them by key.
    absaetze_nach_schluessel: dict[str, str] | None
    placeholder: list[str]


class FLEinwilligungWordingResponse(BaseAPIResponse):
    wording: FLEinwilligungWording


class FLEinwilligungSeitenResponse(BaseAPIResponse):
    """The label each page stamps on a new acceptance today, which a deploy moves: never cached by a reader."""

    running_wordings: dict[str, str]
