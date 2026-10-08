from fastapi import APIRouter, Depends

from app.api.einwilligung.schemas import FLEinwilligungFassungResponse, FLEinwilligungSeitenResponse
from app.api.einwilligung.services import served_fassung
from app.core.config import API_VERSION
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.core.security import verify_access_base
from app.shared.einwilligung import FASSUNGEN, LAUFENDE_FASSUNGEN

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/einwilligung",
    dependencies=[Depends(verify_access_base)],
)


@router.get(
    "/fassungen/{text_version}",
    response_model=FLEinwilligungFassungResponse,
    summary="The words one consent label names",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def get_fassung(text_version: str) -> FLEinwilligungFassungResponse:
    """
    Return the words a consent label names: its paragraphs, its switch, its other controls, its page and the day it took effect.

    A label's words never change, so the answer may be cached. A label the registry does not hold 404s,
    and never answers another label's words.
    """

    fassung = FASSUNGEN.get(text_version)
    if fassung is None:
        raise DocumentNotFoundException(filter={"text_version": text_version}, error_code=DOCUMENT_NOT_FOUND)

    return FLEinwilligungFassungResponse(fassung=served_fassung(text_version, fassung))


@router.get("/seiten", response_model=FLEinwilligungSeitenResponse, summary="The consent label each page stamps today")
async def get_seiten() -> FLEinwilligungSeitenResponse:
    """
    Return, for every page that stamps a consent label, the label a new acceptance on it must name.

    A deploy moves it, so a reader caching it refuses its own visitors' presses until the cache expires.
    """

    return FLEinwilligungSeitenResponse(laufende_fassungen={seite: label for seite, label in LAUFENDE_FASSUNGEN.items()})
