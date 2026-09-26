from typing import Annotated

from fastapi import APIRouter, Body, Depends

from app.api.identitaet.crud import find_subjekt
from app.api.identitaet.schemas import FLSubjektPayload, FLSubjektResponse
from app.core.config import API_VERSION
from app.core.dependencies import SaisonsCollection, SaisonTeamsCollection, SchiedsrichterCollection, SpielerCollection
from app.core.exception_handlers import stores_nothing
from app.core.security import bind_system_actor, verify_access_system
from app.shared.folding import sign_in_identifier

# System tier and the system actor, as `app/api/bewerbungen/zustellung_router.py` declares them: the
# key is held by the frontend process alone (`docs/backend/spec.md :: 1.7`), which is exactly who may
# ask which records a mailbox matches, and no session stands behind the caller.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/identitaet",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)


@router.post(
    "/subjekt",
    response_model=FLSubjektResponse,
    summary="Say which league records one mailbox holds",
    dependencies=[Depends(stores_nothing)],
)
async def get_subjekt(
    subjekt_data: Annotated[FLSubjektPayload, Body()],
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
) -> FLSubjektResponse:
    """
    Answer which confirmed contact seats, pupil records and referee records the league holds for one mailbox.

    Stores nothing, and a POST all the same: the identifier travels in the body so that no path or query carries an address into an
    access line, which is `POST /kontakte/erasure/ansicht`'s reason too.

    The address is folded to the sign-in identifier -- trimmed, its domain in punycode, its ASCII letters lower-cased -- on arrival
    and compared in that form, so `Anna.Mueller@Schule.de` in a contact seat answers for `anna.mueller@schule.de`, and a domain
    asked as `müller.de` for the `xn--mller-kva.de` a record stores. `ß` is not folded to `ss`, so `poststrasse.de` and `poststraße.de`
    are two domains here as they are at sign-in. A `spieler` row is joined by equality instead, that field storing the folded form already.

    A contact seat and a referee record store the address as its payload wrote it -- the local part as typed, the domain in punycode --
    so both are read in two steps: the database narrows to the rows holding the identifier whatever the case of its letters, and the
    fold decides on each candidate's own stored value.

    Neither collection stores a folded copy beside the address it holds: a second copy on two collections has to be kept true by
    every writer that touches either.

    A record is answered only once its own person has confirmed it -- a seat's `einwilligung.bestaetigt_am`, judged per seat, and the
    same stamp on a pupil's and a referee's consent record -- and only while its row is live: a retired pupil or referee is answered
    nothing, and so is the placeholder every erased referee's fixtures name. `unbestaetigt` is true exactly where the mailbox matched
    live records and none of them is confirmed, so an unconfirmed person is told apart from one the league holds nothing for.
    A seat on a `past` season is still answered, carrying its `saison_status`: which seasons grant a panel is each caller's to decide.

    Each list may be empty and each may hold more than one entry: one inbox holds seats at two clubs, and two pupils share an address.
    An address the league holds nothing for is answered with three empty lists and `unbestaetigt` false rather than a 404.
    """

    return await find_subjekt(
        # Folded here as well as by the caller: the payload has already lower-cased the domain, so a
        # value compared as it arrived is half-folded and misses a seat over the local part's case.
        sign_in_identifier(str(subjekt_data.email)),
        saison_teams_collection=saison_teams_collection,
        saisons_collection=saisons_collection,
        spieler_collection=spieler_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        # No transaction: this read judges nothing and writes nothing, and the parameter exists for
        # the caller that will judge a Funktion inside its own.
        session=None,
    )
