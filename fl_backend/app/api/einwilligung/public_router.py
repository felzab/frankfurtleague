from fastapi import APIRouter, Depends

from app.api.einwilligung.schemas import FLEinwilligungSeitenResponse, FLEinwilligungWordingResponse
from app.api.einwilligung.services import served_fassung
from app.core.config import API_VERSION
from app.core.exceptions import DocumentNotFoundError
from app.core.security import verify_access_base
from app.shared.einwilligung import FASSUNGEN, LAUFENDE_FASSUNGEN

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/einwilligung",
    dependencies=[Depends(verify_access_base)],
)


@router.get(
    "/wordings/{text_version}",
    response_model=FLEinwilligungWordingResponse,
    summary="The words one consent label names",
)
async def get_wording(text_version: str) -> FLEinwilligungWordingResponse:
    """The words a consent label names, which never change, so the answer may be cached; 404 for a label the registry lacks."""

    fassung = FASSUNGEN.get(text_version)
    if fassung is None:
        raise DocumentNotFoundError()

    return FLEinwilligungWordingResponse(wording=served_fassung(text_version, fassung))


@router.get("/seiten", response_model=FLEinwilligungSeitenResponse, summary="The consent label each page stamps today")
async def get_seiten() -> FLEinwilligungSeitenResponse:
    """For every page that stamps a consent label, the label a new acceptance on it must name.

    A deploy moves it, so a reader caches it no longer than a request.
    """

    return FLEinwilligungSeitenResponse(running_wordings={seite: label for seite, label in LAUFENDE_FASSUNGEN.items()})
