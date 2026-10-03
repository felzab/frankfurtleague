from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.identitaet.crud import funktionen_of
from app.api.identitaet.services import folds_to
from app.api.konto.schemas import FLKontoEinwilligungenResponse
from app.api.konto.services import (
    build_selbst_seat_pipeline,
    compose_schiedsrichter_selbst,
    compose_sitze_selbst,
    compose_spieler_selbst,
)
from app.api.schiedsrichter.services import EINWILLIGUNG_FELD, SELBST_FIELDS, build_selbst_referee_filter
from app.api.spieler.services import build_selbst_pupil_pipeline
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielerCollection,
    get_german_date_str,
)
from app.core.security import PERSON_ACTOR_BINDERS, verify_access_admin
from app.shared.einwilligung import is_confirmed

# Every person binder fixes a Funktion and this page is none's: `kontakt` is bound, its seat control
# having no page of its own. Nothing here writes, so no record carries it; a write belongs on its
# record's own router.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/konto",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["kontakt"])],
)

Identifier = Annotated[str, Depends(PERSON_ACTOR_BINDERS["kontakt"])]


@router.get("/einwilligungen", response_model=FLKontoEinwilligungenResponse, summary="A signed-in person's own consent records")
async def get_einwilligungen(
    identifier: Identifier,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLKontoEinwilligungenResponse:
    """
    Answer every confirmed consent record the signed-in address holds, its pupil, referee and contact-seat records alike.

    The seats come one entry per team season on which the address holds a confirmed seat, however many of its slots.

    PERSON TIER, for the account page, which every signed-in person reaches: an address holding nothing is answered
    `spieler: null` and two empty lists, never refused. A retired record, a past season's seat and a withdrawn team's
    seat are served too, a withdrawal staying open wherever a consent stands; `erteilbar` says whether a grant is
    admitted, `medien_angeboten` whether the media consent may be switched on. A record awaiting its person's
    confirmation is not served: there is nothing on it yet to change.
    """

    # A snapshot, so every record is answered as of one moment; never a transaction, which a read
    # writing nothing has no conflict to retry for.
    async with db.start_session(snapshot=True) as session:
        pupils = await aggregate_many_from_db(collection=spieler_collection, pipeline=build_selbst_pupil_pipeline(identifier), session=session)
        referees = await aggregate_many_from_db(
            collection=schiedsrichter_collection,
            pipeline=[{"$match": build_selbst_referee_filter(identifier)}, {"$project": dict(SELBST_FIELDS)}, {"$sort": {"_id": 1}}],
            session=session,
        )
        seat_rows = await aggregate_many_from_db(
            collection=saison_teams_collection, pipeline=build_selbst_seat_pipeline(identifier), session=session
        )
        subjekt = await funktionen_of(
            identifier,
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            session=session,
        )

        # The derivation every PATCH authorises a grant against, never a copy of its rule.
        erteilbare_spieler = {eintrag.spieler_id for eintrag in subjekt.spieler}
        erteilbare_schiedsrichter = {eintrag.schiedsrichter_id for eintrag in subjekt.schiedsrichter}
        erteilbare_sitze = {(sitz.team_id, sitz.saison_id) for sitz in subjekt.sitze}

        pupil = next((row for row in pupils if is_confirmed(row.get("einwilligung"))), None)

        return FLKontoEinwilligungenResponse.model_validate(
            {
                "spieler": None if pupil is None else compose_spieler_selbst(pupil, erteilbar=pupil["_id"] in erteilbare_spieler, today=today),
                "schiedsrichter": [
                    compose_schiedsrichter_selbst(row, erteilbar=row["_id"] in erteilbare_schiedsrichter, today=today)
                    for row in referees
                    if folds_to((row.get("kontakt") or {}).get("email"), identifier) and is_confirmed(row.get(EINWILLIGUNG_FELD))
                ],
                "sitze": compose_sitze_selbst(seat_rows, identifier, erteilbar=erteilbare_sitze, today=today),
            }
        )
