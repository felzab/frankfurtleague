from fastapi import APIRouter, Depends

from app.api.spieler.schemas import FLSpielerSingleResponse
from app.api.spieler.services import build_spieler_filter, public_person
from app.core.config import API_VERSION
from app.core.crud import pull_one_from_db
from app.core.dependencies import SpielerCollection
from app.core.routing import by_id
from app.core.security import verify_access_base
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieler",
    dependencies=[Depends(verify_access_base)],
)


@router.get(by_id("spieler_id"), response_model=FLSpielerSingleResponse, summary="One Spieler")
async def get_spieler_by_id(spieler_id: CustomRouteObjectId, spieler_collection: SpielerCollection) -> FLSpielerSingleResponse:
    """One player's id, forename and surname initial, both names `null` where the pupil's consent does not publish them."""

    # NOT the flattened squad shape a club page's squad serves: those are season-scoped, and picking a season
    # here would make the answer depend on a default nobody asked for.

    # An allow-list, as the squad read's `$project` is: the whole person is a birthdate, an address
    # and a consent record, and one materialised here to be discarded is one a later edit can serve.
    spieler_raw = await pull_one_from_db(
        collection=spieler_collection,
        db_filter=build_spieler_filter(spieler_id),
        projection={"vorname": 1, "nachname": 1, "einwilligung": 1},
    )

    # Redacted HERE and whole on the admin echo: this path is base-tier and answers any id it is
    # handed, and an id is no secret -- every administrator's page and link carries one.
    served = public_person(
        vorname=spieler_raw.get("vorname"),
        nachname=spieler_raw.get("nachname"),
        einwilligung=spieler_raw.get("einwilligung"),
    )

    return FLSpielerSingleResponse(spieler_id=spieler_raw["_id"], vorname=served.vorname, nachname=served.nachname)
