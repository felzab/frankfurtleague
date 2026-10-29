from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.services import hash_token
from app.api.einwilligung.services import find_fassung_refusal
from app.api.registrierungen.crud import person_at_the_address
from app.api.registrierungen.schemas import (
    FLRegistrierungBestaetigungAnsichtPayload,
    FLRegistrierungBestaetigungAnsichtResponse,
    FLRegistrierungBestaetigungPayload,
    FLRegistrierungBestaetigungResponse,
)
from app.api.registrierungen.services import (
    BESTAETIGUNG_ANSICHT_FIELDS,
    BESTAETIGUNG_ANTWORT_FIELDS,
    build_bestaetigung_filter,
    compose_confirmation_update,
    find_already_confirmed_refusal,
    find_alter_refusal,
    find_bestaetigung_gesperrt_refusal,
    find_expired_token_refusal,
    find_medien_refusal,
    find_ohne_geburtsdatum_refusal,
    find_unknown_token_refusal,
    find_wahlen_refusal,
    gespeichertes_geburtsdatum,
    seite_of,
    zustand_of,
)
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, sperrliste_saison
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import (
    DBClient,
    RegistrierungenCollection,
    SpielerCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.recording import log_stamp
from app.core.security import bind_public_actor, verify_access_base
from app.core.transactions import transaction_session
from app.shared.schemas.bounds import MEDIEN_MIN_AGE_YEARS, REGISTRIERUNG_MIN_ALTER_JAHRE

# A router of its own beside the public submission and the administrator's read: the token is the
# whole credential, so both endpoints are base-tier and bind the public actor rather than the
# `X-FL-Actor` no browser sends.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/registrierungen/bestaetigung",
    dependencies=[Depends(verify_access_base), Depends(bind_public_actor)],
)


@router.post(
    "/ansicht",
    response_model=FLRegistrierungBestaetigungAnsichtResponse,
    summary="What one registration confirmation link opens",
)
async def get_bestaetigung_ansicht(
    ansicht_data: Annotated[FLRegistrierungBestaetigungAnsichtPayload, Body()],
    registrierungen_collection: RegistrierungenCollection,
    teams_collection: TeamsCollection,
    spieler_collection: SpielerCollection,
    sperrliste: SperrlisteLookup,
    today: str = Depends(get_german_date_str),
) -> FLRegistrierungBestaetigungAnsichtResponse:
    """
    Answer what the page renders for the registration this token opens, and no part of the registration beyond it.

    The link's state, the team and its school, the season, the age floor the press will be judged by, the age from
    which the media switch is offered, and which of two pages the link opens. Never the pupil's name: the link went to
    an address nobody has confirmed, which behind a typo is a stranger's.

    `bestaetigung_spieler_wiederkehrend` is the returning pupil's: a stored person at the registration's folded
    address under its folded name who confirmed their own record. That page asks no choice and no birthdate, taking
    the person's own; nothing the person's record holds is served, the holder of a mailed link not yet being known
    to be that person. Matched on the address alone, a mailbox shared anyway would hand a sibling that person's
    page, so the name narrows the match.

    A POST that reads, so the token travels in a body and never in a second URL. Refuses only a token no
    registration holds (`REQ-REGISTRIERUNG-004`): a confirmed or an expired link is SERVED in that state rather
    than refused, so a reopened link shows what became of it. The state is `gesperrt`, ahead of every other, wherever
    the ban list holds the address the link was mailed to (`REQ-REGISTRIERUNG-012`), so the page offers a barred
    pupil nothing to press.
    """

    token_hash = hash_token(ansicht_data.token)

    # `find_one` rather than `pull_one_from_db`: a miss is this endpoint's own refusal, never a 404.
    raw = await registrierungen_collection.find_one(
        build_bestaetigung_filter(token_hash=token_hash), projection=dict(BESTAETIGUNG_ANSICHT_FIELDS)
    )
    refuse(find_unknown_token_refusal(found=raw is not None))
    assert raw is not None

    # `find_one` rather than `pull_one_from_db`: no team is ever deleted, so a miss is a broken
    # invariant rather than a 404 this view could answer, and never an empty slot in the consent text.
    team_raw = await teams_collection.find_one({"_id": raw["team_id"]}, projection={"name": 1, "full_name": 1})
    assert team_raw is not None

    person = await person_at_the_address(spieler_collection=spieler_collection, registrierung_raw=raw, session=None)
    seite = seite_of(registrierung_raw=raw, person_raw=person)

    gesperrt = await adressen_gesperrt(sperrliste, [str(raw.get("email") or "")])

    return FLRegistrierungBestaetigungAnsichtResponse(
        zustand=zustand_of(registrierung_raw=raw, today=today, gesperrt=bool(gesperrt)),
        team=str(team_raw["name"]),
        schule=str(team_raw["full_name"]),
        saison_id=str(raw["saison_id"]),
        seite=seite,
        mindestalter=REGISTRIERUNG_MIN_ALTER_JAHRE,
        medien_mindestalter=MEDIEN_MIN_AGE_YEARS,
    )


@router.post(
    "",
    response_model=FLRegistrierungBestaetigungResponse,
    summary="Confirm one registration and record the pupil's consent",
)
async def post_bestaetigung(
    antwort_data: Annotated[FLRegistrierungBestaetigungPayload, Body()],
    registrierungen_collection: RegistrierungenCollection,
    spieler_collection: SpielerCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLRegistrierungBestaetigungResponse:
    """
    Record a pupil's own answer for the registration their link opens: their date of birth and the consent record, in one update.

    Which page the link opens is resolved again here, as the view resolves it. On the new pupil's page the record
    carries the publication scope they chose, the media answer beside it, the stamp and the wording they were shown.
    On the returning pupil's page, which asks no choice, it carries the stamp and the wording alone: the choices
    standing on the person's own record are theirs to change on the account page, and nothing here re-grants one.
    Its body carries no birthdate: the person's stored one, read here, is judged and written, and the answer echoes
    null rather than the stored date.

    Refuses, in this order: a token no registration holds (`REQ-REGISTRIERUNG-004`), a link whose deadline has
    passed or whose registration has been decided (`-005`), a registration already confirmed (`-006`), any label but
    the running one of the page the link opens now (`REQ-EINWILLIGUNG-001`), answers that are not the ones that page
    asks -- both choices and a birthdate on the new pupil's, none of the three on the returning pupil's
    (`REQ-REGISTRIERUNG-017`) -- a returning pupil's person holding no birthdate to take (`-019`), a link mailed to an
    address the ban list holds now, whenever the link was minted (`REQ-REGISTRIERUNG-012`), an age below the floor
    (`-007`), and a media consent from a pupil below `medien_mindestalter` (`REQ-REGISTRIERUNG-010`). Every one is
    judged before anything is written, so a reloaded page or a mistyped year spends nothing and the pupil keeps the
    link.

    The registration stays pending after this: an admission is a later decision, and nothing here writes a person
    or a squad row.
    """

    token_hash = hash_token(antwort_data.token)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

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
        # In-session, so a person confirmed, erased or re-dated since the view was read moves the page and
        # the date this press is judged against, and the page it showed is told to reload rather than
        # stored under the other.
        person = await person_at_the_address(spieler_collection=spieler_collection, registrierung_raw=raw, session=session)
        seite = seite_of(registrierung_raw=raw, person_raw=person)
        gespeichert = gespeichertes_geburtsdatum(seite=seite, person_raw=person)
        # A new acceptance: the running label alone, so a page loaded before a deploy is told to reload.
        refuse(find_fassung_refusal(seite=seite, genannt={"einwilligung": antwort_data.text_version}))
        refuse(
            find_wahlen_refusal(
                seite=seite,
                umfang=antwort_data.umfang,
                medien=antwort_data.medien,
                geburtsdatum=antwort_data.geburtsdatum,
            )
        )
        refuse(find_ohne_geburtsdatum_refusal(seite=seite, gespeichert=gespeichert))
        # Exactly one of the two is set once the refusals above have passed.
        geburtsdatum = antwort_data.geburtsdatum or gespeichert
        assert geburtsdatum is not None
        # Asked at the press rather than only at the mint: a ban entered after the link went out
        # stops it here, and one lifted while it runs lets it answer again.
        gesperrt = await adressen_gesperrt(
            sperrliste, [str(raw.get("email") or "")], massgebliche_saison_id=massgebliche_saison_id, session=session
        )
        refuse(find_bestaetigung_gesperrt_refusal(gesperrt=bool(gesperrt)))
        refuse(find_alter_refusal(geburtsdatum=geburtsdatum, today=today))
        refuse(find_medien_refusal(geburtsdatum=geburtsdatum, medien=antwort_data.medien is True, today=today))

        await patch_one_in_db(
            collection=registrierungen_collection,
            db_filter={"_id": raw["_id"]},
            update=compose_confirmation_update(
                geburtsdatum=geburtsdatum,
                umfang=antwort_data.umfang,
                medien=antwort_data.medien,
                text_version=antwort_data.text_version,
                today=today,
                am=log_stamp(germany_now),
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

    async with transaction_session(db) as session:
        return await session.with_transaction(answer_for_the_pupil)
