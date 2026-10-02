from typing import Annotated

from fastapi import APIRouter, Body, Depends

from app.api.berechtigungen.crud import verwaltung_of
from app.api.identitaet.crud import find_subjekt
from app.api.identitaet.schemas import FLSubjektPayload, FLSubjektResponse
from app.api.sperrliste.lookup import SperrlisteLookup, hash_gesperrt
from app.core.concurrency import gather_cancelling
from app.core.config import API_VERSION
from app.core.dependencies import (
    BerechtigungenCollection,
    SaisonsCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielerCollection,
)
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
    sperrliste: SperrlisteLookup,
    berechtigungen_collection: BerechtigungenCollection,
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
    same stamp on a pupil's and a referee's consent record, an empty stamp confirming nothing -- and only while its row is live: a
    retired pupil or referee is answered nothing, and so is the placeholder every erased referee's fixtures name. A seat on a season
    its team withdrew from, by disqualification or withdrawal alike, is answered nothing either; its seats on other seasons stand.
    A seat on a `past` season is still answered, carrying its `saison_status`: which seasons grant a panel is each caller's to decide.

    `unbestaetigt` is true exactly where the mailbox holds records that could grant a panel -- a live pupil or referee row, or a seat
    on an `active` or `future` season -- and none of them is confirmed, so an unconfirmed person is told apart from one the league
    holds nothing for. A seat on a `past` season counts toward neither answer: confirming it would open nothing.

    `gesperrt` says whether the address is on the ban list, judged as a sign-up is: the address in any spelling that folds to the same
    mailbox, and a ban only while the running season is within its bound. It narrows none of the records beside it.

    `verwaltung` is the grant the mailbox holds in `berechtigungen` -- `owner`, `administration`, or null for none -- matched on the
    folded identifier alone, the one spelling a grant is stored in. It is the one stored answer here: whether a person is an
    administrator is decided by a grant rather than derived from a league record, and it narrows none of the records beside it.

    `berechtigt_seit` is when that grant took effect, null exactly where `verwaltung` is: the moment `POST /berechtigungen/abgleich`
    first found a grant made in the database directly, and the grant's own `erteilt_am` for one made through the application or not
    yet found. A tier change leaves it standing. An admin-tier request from a sign-in older than it is refused.

    Each list may be empty and each may hold more than one entry: one person holds seats at two clubs, and nothing enforces one pupil
    record per address.
    An address the league holds nothing for is answered with three empty lists and `unbestaetigt` false rather than a 404.
    """

    # Folded here as well as by the caller: the payload has already lower-cased the domain, so a
    # value compared as it arrived is half-folded and misses a seat over the local part's case.
    identifier = sign_in_identifier(str(subjekt_data.email))

    # Keyed from the payload's own value, as the ban write keys it: that payload type runs the rule
    # `canonical_address` runs, so an address the hash would refuse was answered 422 before here.
    ban_key = sperrliste.hash_of(str(subjekt_data.email))

    # Concurrently, every page a signed-in person or an administrator renders waiting on this answer:
    # the records, the ban and the grant cost the longest of the three rather than their sum.
    subjekt, gesperrt, grant = await gather_cancelling(
        find_subjekt(
            identifier,
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            # No transaction, which is also what lets the three run at once: one session runs one
            # operation at a time. The parameter exists for the caller that judges a Funktion inside its own.
            session=None,
        ),
        hash_gesperrt(sperrliste, ban_key),
        verwaltung_of(berechtigungen_collection=berechtigungen_collection, adresse=identifier),
    )
    verwaltung, berechtigt_seit = (None, None) if grant is None else grant

    return FLSubjektResponse(**subjekt.model_dump(), gesperrt=gesperrt, verwaltung=verwaltung, berechtigt_seit=berechtigt_seit)
