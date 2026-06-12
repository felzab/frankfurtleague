from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import JSONResponse

from app.api.meta.schemas import FlSaison
from app.core.config import backend_config
from app.core.crud import pull_from_db
from app.core.dependencies import SaisonsCollection
from app.core.security import verify_access_base

router = APIRouter(prefix=f"/api/v{backend_config.api_version}/meta", dependencies=[Depends(verify_access_base)])


@router.get("/saison_metadata")
async def get_saison_metadata(saisons_collection: SaisonsCollection, saison_id: str | None = Query(default=None)):

    saison_metadata_raw = await pull_from_db(
        collection=saisons_collection, filter={"status": "active"} if saison_id is None else {"_id": saison_id}
    )
    saison_metadata = FlSaison.model_validate(saison_metadata_raw[0])  # index 0, because only one document should be returned

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={"acknowledged": 1, "saison_metadata": saison_metadata.model_dump(mode="json")},
    )
