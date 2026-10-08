from typing import Annotated

from fastapi import APIRouter, Body, Depends

from app.api.berechtigungen.crud import verwaltung_of
from app.api.identitaet.crud import find_anmeldung, find_subjekt
from app.api.identitaet.lookup import SubjektLookup
from app.api.identitaet.schemas import FLAnmeldungResponse, FLGesperrtPayload, FLGesperrtResponse, FLSubjektPayload, FLSubjektResponse
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, hash_gesperrt
from app.core.concurrency import gather_cancelling
from app.core.config import API_VERSION
from app.core.dependencies import BerechtigungenCollection
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
    records: SubjektLookup,
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
    administrator is decided by a grant rather than derived from a league record, and it narrows none of the records beside it. A
    promotion to `owner` made in the database is answered `administration` until `POST /berechtigungen/abgleich` finds it.

    `berechtigt_seit` is when that grant took effect, null exactly where `verwaltung` is: the moment `POST /berechtigungen/abgleich`
    first found a grant made in the database directly, the grant's own `erteilt_am` for one made through the application, and for one
    made in the database that no call to that endpoint has read yet, its `erteilt_am` or the moment its id was generated, whichever is
    later. A row changed in the database after that endpoint read it -- an address changed in place, a spelling no request matched
    made one that does, a row put back after its removal was found -- is no grant, `verwaltung` null, until that endpoint finds the
    change. A tier change leaves it standing. An admin-tier request from a sign-in older than it is refused.

    `inhaber_seit` is when the `owner` tier took effect, null exactly where `verwaltung` is not `owner`: the moment the tier change
    made the grant an owner's, or that endpoint found a promotion made in the database, and never earlier than `berechtigt_seit`. A
    sign-in older than it administers and holds no owner's power, so the revoke and the tier change it asks for are refused. A
    demotion takes the tier at once.

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
    dependencies=[Depends(stores_nothing)],
)
async def get_anmeldung(
    anmeldung_data: Annotated[FLSubjektPayload, Body()],
    records: SubjektLookup,
    sperrliste: SperrlisteLookup,
    berechtigungen_collection: BerechtigungenCollection,
) -> FLAnmeldungResponse:
    """
    Answer what the sign-in gate decides on for one mailbox: its own records, its pending confirmation, its ban and its grant.

    No record, name or id is answered, only flags and the grant's tier. Stores nothing, and a POST for `POST /identitaet/subjekt`'s
    reason. The address is folded on arrival and compared as that endpoint compares it, and `unbestaetigt`, `gesperrt` and
    `verwaltung` are that endpoint's own answers.

    `konto` is true exactly where the mailbox holds a record its own person confirmed: a contact seat on any season row, a past
    season's and a withdrawn team's included; a contact seat on a pending application; a pupil or referee record, a retired one
    included, never the placeholder every erased referee's fixtures name; and a pending registration whose pupil confirmed it with
    a choice. A decided application, a declined registration and every unconfirmed record count for nothing. It holds wherever
    `POST /identitaet/subjekt` answers a record, and also where the only records are ones granting no panel.

    The ban narrows neither flag: a barred address holding records is answered `gesperrt` and `konto` both, and refusing it is the
    caller's. A mailbox the league holds nothing for is answered both flags false rather than a 404.
    """

    # Folded and keyed as `get_subjekt` folds and keys, for its reasons.
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
    dependencies=[Depends(stores_nothing)],
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
