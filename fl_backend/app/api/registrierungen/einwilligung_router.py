from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.services import hash_token
from app.api.registrierungen.schemas import (
    FLRegistrierungBestaetigungAnsichtPayload,
    FLRegistrierungBestaetigungAnsichtResponse,
    FLRegistrierungBestaetigungPayload,
    FLRegistrierungBestaetigungResponse,
)
from app.api.registrierungen.services import (
    BESTAETIGUNG_ANSICHT_FIELDS,
    BESTAETIGUNG_ANTWORT_FIELDS,
    PERSON_IDENTITY_FIELDS,
    answers_shown_back,
    build_bestaetigung_filter,
    compose_confirmation_update,
    find_already_confirmed_refusal,
    find_alter_refusal,
    find_expired_token_refusal,
    find_medien_refusal,
    find_unknown_token_refusal,
    persons_named,
    sole_person,
    zustand_of,
)
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, pull_many_from_db, pull_one_from_db, refuse
from app.core.dependencies import DBClient, RegistrierungenCollection, SpielerCollection, TeamsCollection, get_german_date_str
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE, stores_nothing
from app.core.security import bind_public_actor, verify_access_base
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import MEDIEN_MIN_AGE_YEARS, REGISTRIERUNG_MIN_ALTER_JAHRE

# A router of its own beside the public submission and the administrator's read: the token is the
# whole credential, so both endpoints are base-tier and bind the public actor rather than the
# `X-FL-Actor` no browser sends.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/registrierungen/bestaetigung",
    dependencies=[Depends(verify_access_base), Depends(bind_public_actor)],
)

# A household rather than a person: one mailbox stands behind several pupils, and the read is
# bounded so a larger one narrows to nothing rather than to a guess.
_PERSONS_READ = 8


@router.post(
    "/ansicht",
    response_model=FLRegistrierungBestaetigungAnsichtResponse,
    summary="What one registration confirmation link opens",
    dependencies=[Depends(stores_nothing)],
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def get_bestaetigung_ansicht(
    ansicht_data: Annotated[FLRegistrierungBestaetigungAnsichtPayload, Body()],
    registrierungen_collection: RegistrierungenCollection,
    teams_collection: TeamsCollection,
    spieler_collection: SpielerCollection,
    today: str = Depends(get_german_date_str),
) -> FLRegistrierungBestaetigungAnsichtResponse:
    """
    Answer what the page renders for the registration this token opens, and no part of the registration beyond it.

    The link's state, the team and its school, the season, the pupil's own first name, the age floor the press
    will be judged by, the age from which the media switch is offered, and the wording's version. Beside them the
    three answers the league already holds for this person -- the birthdate, the publication scope and the media
    switch -- so a returning pupil confirms what stands rather than entering it again. That person is matched on
    the registration's folded address AND its folded name: a mailbox a family shares stands behind more than one
    pupil, so an address alone would show one of them another's birthdate. All three are null wherever that match is not exactly one person.

    A POST that reads, so the token travels in a body and never in a second URL. Refuses only a token no
    registration holds (`REQ-REGISTRIERUNG-004`): a confirmed or an expired link is SERVED in that state rather
    than refused, so a reopened link shows what became of it.
    """

    token_hash = hash_token(ansicht_data.token)

    # `find_one` rather than `pull_one_from_db`: a miss is this endpoint's own refusal, never a 404.
    raw = await registrierungen_collection.find_one(
        build_bestaetigung_filter(token_hash=token_hash), projection=dict(BESTAETIGUNG_ANSICHT_FIELDS)
    )
    refuse(find_unknown_token_refusal(found=raw is not None))
    assert raw is not None

    # A 404 rather than an empty slot: the two names are rendered INTO the consent text, and a
    # paragraph missing its subject reads as finished.
    team_raw = await pull_one_from_db(collection=teams_collection, db_filter={"_id": raw.get("team_id")}, projection=["name", "full_name"])

    # An equality on the folded form, which is what `spieler.email` stores.
    persons = await pull_many_from_db(
        collection=spieler_collection,
        db_filter={"email": sign_in_identifier(str(raw.get("email") or ""))},
        # One PAST the bound, so a larger household is seen to be larger: capped at the bound, the read
        # answers a subset of a larger household, and a namesake left outside it makes the other look sole.
        limit=_PERSONS_READ + 1,
        projection=[*PERSON_IDENTITY_FIELDS, "geburtsdatum", "einwilligung"],
    )
    household = persons if len(persons) <= _PERSONS_READ else []

    # Narrowed by the NAME before anything is shown back: a mailbox a family shares stands behind
    # more than one pupil.
    named = persons_named(household, vorname=raw.get("vorname"), nachname=raw.get("nachname"))

    shown_back = answers_shown_back(registrierung_raw=raw, spieler_raw=sole_person(named))
    einwilligung = shown_back.get("einwilligung") or {}

    return FLRegistrierungBestaetigungAnsichtResponse(
        zustand=zustand_of(registrierung_raw=raw, today=today),
        team=str(team_raw["name"]),
        schule=str(team_raw["full_name"]),
        saison_id=str(raw["saison_id"]),
        vorname=str(raw["vorname"]),
        text_version=einwilligung.get("text_version"),
        mindestalter=REGISTRIERUNG_MIN_ALTER_JAHRE,
        medien_mindestalter=MEDIEN_MIN_AGE_YEARS,
        geburtsdatum=shown_back.get("geburtsdatum"),
        umfang=einwilligung.get("umfang"),
        medien=einwilligung.get("medien"),
    )


@router.post(
    "",
    response_model=FLRegistrierungBestaetigungResponse,
    summary="Confirm one registration and record the pupil's consent",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def post_bestaetigung(
    antwort_data: Annotated[FLRegistrierungBestaetigungPayload, Body()],
    registrierungen_collection: RegistrierungenCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLRegistrierungBestaetigungResponse:
    """
    Record a pupil's own answer for the registration their link opens: their date of birth and the whole consent record, in one update.

    The record carries the publication scope they chose, the media answer beside it, the stamp and the wording they
    were shown. A returning pupil's press writes the record again under the label current that day, so a consent
    given under older words is renewed under the words this person just read.

    Refuses, in this order: a token no registration holds (`REQ-REGISTRIERUNG-004`), a link whose deadline has
    passed or whose registration has been decided (`-005`), a registration already confirmed (`-006`), an age
    below the floor (`-007`), and a media consent from a pupil below `medien_mindestalter` (`REQ-REGISTRIERUNG-010`) -- the last two judged
    before anything is written, so a mistyped year spends nothing and the pupil keeps the link.

    The registration stays pending after this: an admission is a later decision, and nothing here writes a person
    or a squad row.
    """

    token_hash = hash_token(antwort_data.token)

    async def answer_for_the_pupil(session: AsyncClientSession) -> FLRegistrierungBestaetigungResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it.

        One transaction, so a second press landing between the read and the write is refused by
        the stamp rather than overwriting the answer already given.
        """

        raw = await registrierungen_collection.find_one(
            build_bestaetigung_filter(token_hash=token_hash), projection=dict(BESTAETIGUNG_ANTWORT_FIELDS), session=session
        )
        refuse(find_unknown_token_refusal(found=raw is not None))
        assert raw is not None

        refuse(find_expired_token_refusal(bestaetigung=raw.get("bestaetigung"), status=raw.get("status"), today=today))
        refuse(find_already_confirmed_refusal(einwilligung=raw.get("einwilligung")))
        refuse(find_alter_refusal(geburtsdatum=antwort_data.geburtsdatum, today=today))
        refuse(find_medien_refusal(geburtsdatum=antwort_data.geburtsdatum, medien=antwort_data.medien, today=today))

        await patch_one_in_db(
            collection=registrierungen_collection,
            db_filter={"_id": raw["_id"]},
            update=compose_confirmation_update(
                geburtsdatum=antwort_data.geburtsdatum,
                umfang=antwort_data.umfang,
                medien=antwort_data.medien,
                text_version=antwort_data.text_version,
                today=today,
            ),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

        # The payload's own three rather than the updated document's: this answer is what the page
        # states back, and re-reading the row would widen it to everything a registration holds.
        return FLRegistrierungBestaetigungResponse(
            ergebnis="bestaetigt",
            geburtsdatum=antwort_data.geburtsdatum,
            umfang=antwort_data.umfang,
            medien=antwort_data.medien,
        )

    async with db.start_session() as session:
        return await session.with_transaction(answer_for_the_pupil)
