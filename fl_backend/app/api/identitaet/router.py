from typing import Annotated

from fastapi import APIRouter, Body, Depends

from app.api.berechtigungen.crud import verwaltung_of
from app.api.identitaet.crud import find_anmeldung, find_subjekt, unreferenced_of
from app.api.identitaet.lookup import SubjektLookup
from app.api.identitaet.schemas import (
    FLAnmeldungResponse,
    FLGesperrtPayload,
    FLGesperrtResponse,
    FLReferenzenPayload,
    FLReferenzenResponse,
    FLSubjektPayload,
    FLSubjektResponse,
)
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, hash_gesperrt
from app.core.concurrency import gather_cancelling
from app.core.config import API_VERSION
from app.core.dependencies import AdresswechselPostausgangCollection, BerechtigungenCollection
from app.core.security import bind_system_actor, verify_access_system
from app.shared.folding import sign_in_identifier

# System tier and the system actor: the key is held by the frontend process alone, which is exactly
# who may ask which records a mailbox matches, and no session stands behind the caller.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/identitaet",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)


@router.post(
    "/subjekt",
    response_model=FLSubjektResponse,
    summary="Say which league records one mailbox holds",
)
async def get_subjekt(
    subjekt_data: Annotated[FLSubjektPayload, Body()],
    records: SubjektLookup,
    sperrliste: SperrlisteLookup,
    berechtigungen_collection: BerechtigungenCollection,
) -> FLSubjektResponse:
    """Answer which confirmed, live contact seats, pupil records and referee records one mailbox holds, with its ban and its grant.

    The address is matched on the sign-in fold, and a mailbox the league holds nothing for is answered with three empty lists rather
    than a 404.
    """

    identifier = sign_in_identifier(str(subjekt_data.email))

    # Keyed from the payload's own value, as the ban write keys it: that payload type runs the rule
    # `canonical_address` runs, so an address the hash would refuse was answered 422 before here.
    ban_key = sperrliste.hash_of(str(subjekt_data.email))

    # Concurrently, every page a signed-in person or an administrator renders waiting on this answer:
    # the records, the ban and the grant cost the longest of the three rather than their sum.
    subjekt, gesperrt, grant = await gather_cancelling(
        find_subjekt(identifier, records),
        hash_gesperrt(sperrliste, ban_key),
        verwaltung_of(berechtigungen_collection=berechtigungen_collection, adresse=identifier),
    )
    verwaltung, berechtigt_seit, inhaber_seit = (None, None, None) if grant is None else grant

    return FLSubjektResponse(
        **subjekt.model_dump(), gesperrt=gesperrt, verwaltung=verwaltung, berechtigt_seit=berechtigt_seit, inhaber_seit=inhaber_seit
    )


@router.post(
    "/anmeldung",
    response_model=FLAnmeldungResponse,
    summary="Say whether one mailbox may be offered a sign-in",
)
async def get_anmeldung(
    anmeldung_data: Annotated[FLSubjektPayload, Body()],
    records: SubjektLookup,
    sperrliste: SperrlisteLookup,
    berechtigungen_collection: BerechtigungenCollection,
) -> FLAnmeldungResponse:
    """Answer what the sign-in gate decides on for one mailbox: two flags, its ban and its grant's tier, and never a record.

    The address is matched on the sign-in fold, and a mailbox the league holds nothing for is answered with both flags false.
    """

    # Keyed as `get_subjekt` keys, for its reason.
    identifier = sign_in_identifier(str(anmeldung_data.email))
    ban_key = sperrliste.hash_of(str(anmeldung_data.email))

    # Concurrently, for `get_subjekt`'s reason: a sign-in waits on this answer.
    anmeldung, gesperrt, grant = await gather_cancelling(
        find_anmeldung(identifier, records),
        hash_gesperrt(sperrliste, ban_key),
        verwaltung_of(berechtigungen_collection=berechtigungen_collection, adresse=identifier),
    )

    return FLAnmeldungResponse(**anmeldung.model_dump(), gesperrt=gesperrt, verwaltung=None if grant is None else grant[0])


@router.post(
    "/gesperrt",
    response_model=FLGesperrtResponse,
    summary="Say whether a ban stands on an address about to be mailed",
)
async def get_gesperrt(gesperrt_data: Annotated[FLGesperrtPayload, Body()], sperrliste: SperrlisteLookup) -> FLGesperrtResponse:
    """
    Answer whether a standing ban holds the one address the frontend's mailer is about to send to.

    Stores nothing, and a POST for `POST /identitaet/subjekt`'s reason: the address travels in the body, so no path or query carries it
    into an access line.

    The address is judged as a stored one is: every spelling that folds to the same mailbox -- its letters in any case, its domain in
    Unicode or in punycode -- answers alike, and a ban holds only while the running season is within its bound, every ban holding
    while no season runs. An address today's address rule refuses is answered `false` rather than refused, no ban being keyable
    under it: the mailer sends to the addresses records hold, some of them stored under older rules.

    The flag is the whole answer. No record the address holds and no part of the ban reaches the caller, which needs neither.
    """

    # The stored-address judgement rather than the payload's own key, which `get_subjekt` takes: an
    # address no ban can key answers false here, where keying it would raise.
    gesperrt = await adressen_gesperrt(sperrliste, [gesperrt_data.email])

    return FLGesperrtResponse(gesperrt=bool(gesperrt))


@router.post(
    "/referenzen",
    response_model=FLReferenzenResponse,
    summary="Say which of these sign-in addresses no record references",
)
async def get_referenzen(
    referenzen_data: Annotated[FLReferenzenPayload, Body()],
    records: SubjektLookup,
    berechtigungen_collection: BerechtigungenCollection,
    adresswechsel_postausgang_collection: AdresswechselPostausgangCollection,
) -> FLReferenzenResponse:
    """Answer which of these sign-in addresses no league record references, each once and in the spelling it was asked in.

    The whole batch is refused while no live grant is an owner's, since such a database would call every address unreferenced.
    """

    return FLReferenzenResponse(
        unreferenziert=await unreferenced_of(
            referenzen_data.identifiers,
            records,
            berechtigungen_collection=berechtigungen_collection,
            adresswechsel_postausgang_collection=adresswechsel_postausgang_collection,
        )
    )
