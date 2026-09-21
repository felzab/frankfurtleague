from typing import Annotated

from fastapi import APIRouter, Body, Depends

from app.api.identitaet.crud import find_subjekt
from app.api.identitaet.schemas import FLSubjektPayload, FLSubjektResponse
from app.core.config import API_VERSION
from app.core.dependencies import SaisonsCollection, SaisonTeamsCollection, SchiedsrichterCollection, SpielerCollection
from app.core.security import bind_system_actor, verify_access_system
from app.shared.folding import sign_in_identifier

# System tier and the system actor, as `app/api/bewerbungen/zustellung_router.py` declares them: the
# key is held by the frontend process alone (`docs/backend/spec.md :: 1.7`), which is exactly who may
# ask which records a mailbox matches, and no session stands behind the caller.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/identitaet",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)


@router.post("/subjekt", response_model=FLSubjektResponse, summary="Say which league records one mailbox holds")
async def get_subjekt(
    subjekt_data: Annotated[FLSubjektPayload, Body()],
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
) -> FLSubjektResponse:
    """
    Answer which contact seats, pupil records and referee records the league holds for one mailbox.

    Stores nothing, and a POST all the same: the identifier travels in the body so that no path or query carries an address into an
    access line, which is `POST /kontakte/erasure/ansicht`'s reason too.

    The address is folded to the sign-in identifier -- NFKC, lower-cased, trimmed -- on arrival and compared in that form, so
    `Anna.Müller@Schule.de` in a contact seat answers for `anna.müller@schule.de`. `ß` is not folded to `ss`, so `poststrasse@` and
    `poststraße@` are two mailboxes here as they are at sign-in. A `spieler` row is joined by equality instead, that field storing the
    folded form already.

    A contact seat and a referee record store the address as it was typed, so both are read in two steps: a case-insensitive database
    match narrows, and the fold decides on each candidate's own stored value. The two rules differ, and the database's is the wider --
    it holds U+0345 equal to an iota, where the fold leaves them two addresses -- so a row the match reaches is one the fold may still
    refuse, and that refusal is what keeps this answer's rule the same rule sign-in applies.

    A stored address in a decomposed Unicode form is MISSED, the match comparing code points and normalising nothing, so a composed
    identifier does not reach a decomposed spelling of the same address. Every address written through this API arrives composed, which
    is why neither collection stores a folded copy beside the address it holds: a second copy on two collections has to be kept true by
    every writer that touches either, for an edge no write path here produces.

    Each list may be empty and each may hold more than one entry: one inbox holds seats at two clubs, and two pupils share an address.
    An address the league holds nothing for is answered with three empty lists rather than a 404.
    """

    return await find_subjekt(
        # Folded here as well as by the caller: `EmailStr` has already lower-cased the domain, so a
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
