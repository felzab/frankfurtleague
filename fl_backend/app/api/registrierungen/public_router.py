from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Header
from pydantic import UUID4
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.services import build_schluessel_filter, days_after, payload_fingerabdruck
from app.api.einladungen.services import find_live_einladung_filter, find_unknown_einladung_refusal
from app.api.einwilligung.services import find_fassung_refusal
from app.api.postausgang.schemas import FLPostausgangBezug, FLRegistrierungLinkDaten
from app.api.postausgang.services import OwedMail, enqueue_mails
from app.api.registrierungen.crud import person_at_the_address
from app.api.registrierungen.schemas import (
    FLEinladungAnsichtResponse,
    FLPostRegistrierungPayload,
    FLPostRegistrierungResponse,
    FLRegistrierungBestaetigungAnsichtResponse,
    FLRegistrierungBestaetigungPayload,
    FLRegistrierungBestaetigungResponse,
)
from app.api.registrierungen.services import (
    BESTAETIGUNG_ANSICHT_FIELDS,
    BESTAETIGUNG_ANTWORT_FIELDS,
    REGISTRIERUNG_LINK,
    build_bestaetigung_filter,
    compose_bestaetigung,
    compose_confirmation_update,
    compose_registrierung,
    find_abweichender_fingerabdruck_refusal,
    find_already_confirmed_refusal,
    find_alter_refusal,
    find_bestaetigung_gesperrt_refusal,
    find_expired_token_refusal,
    find_fenster_refusal,
    find_gesperrt_refusal,
    find_kader_refusal,
    find_medien_refusal,
    find_schon_aufgenommen_refusal,
    find_stufe_refusal,
    find_team_junction_refusal,
    find_unknown_token_refusal,
    find_wahlen_refusal,
    gespeichertes_geburtsdatum,
    saison_nimmt_registrierungen_an,
    seite_of,
    zustand_of,
)
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, hash_gesperrt, sperrliste_saison
from app.api.spieltage.crud import nachnominierung_laeuft_in
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, post_one_to_db, pull_one_from_db, refuse
from app.core.dependencies import (
    DBClient,
    EinladungenCollection,
    PostausgangCollection,
    RegistrierungenCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SpielerCollection,
    SpieltageCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.recording import log_stamp
from app.core.security import bind_public_actor, verify_access_base
from app.core.transactions import transaction_session
from app.shared.schemas.bestaetigung import FLTokenPayload
from app.shared.schemas.bounds import MEDIEN_MIN_AGE_YEARS, REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE, REGISTRIERUNG_MIN_ALTER_JAHRE
from app.shared.tokens import hash_token

# `bind_public_actor`, never `bind_actor`: no browser sends `X-FL-Actor`, so that guard would refuse
# every registration with `missing_actor`. The write still passes `app/core/crud.py`, and an insert
# records no `before`.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/registrierungen",
    dependencies=[Depends(verify_access_base), Depends(bind_public_actor)],
)


# What a season read serves this tier: the two rules a form is bounded by, the window, and the
# status the page words a closed link with. No other field of a season reaches an invite's holder.
SAISON_PROJECTION = ["registrierung", "rules.erlaubte_stufen", "rules.max_kadergroesse", "status"]

# What a replay reads of the registration its key found: the digest it is compared by.
WIEDERHOLUNG_PROJECTION = ["idempotenz_fingerabdruck"]

# `refuse_withheld_saison` is deliberately NOT called below, where every other base-tier season read
# calls it: a season taking registrations is normally `future`, so that guard would 404 the flow
# this exists for. The INVITE authorises instead.


def _live_squad_filter(*, saison_id: str, team_id: Any) -> dict[str, Any]:
    """Which rows count towards `max_kadergroesse`, as `app/api/spieler/services.py :: build_live_squad_filter` counts them.

    Retired rows are out: a player who left gave their place back. Nothing else is excluded, a
    registration not yet being a squad row.
    """

    return {"saison_id": saison_id, "team_id": team_id, "inactive_since": None}


async def _open_einladung(*, einladungen_collection: Any, token: str, session: AsyncClientSession | None = None) -> Any:
    """The live invite a presented link opens, or a refusal.

    ONE code for unknown and for revoked, the reason `link_ungueltig` records: nothing tells a
    stranger's guess from a link an administrator replaced.
    """

    einladung_raw = await einladungen_collection.find_one(find_live_einladung_filter(token_hash=hash_token(token)), session=session)
    refuse(find_unknown_einladung_refusal(einladung_raw=einladung_raw))

    return einladung_raw


@router.post(
    "/einladung/ansicht",
    response_model=FLEinladungAnsichtResponse,
    summary="What a registration link opens",
)
async def post_einladung_ansicht(
    ansicht_data: Annotated[FLTokenPayload, Body()],
    einladungen_collection: EinladungenCollection,
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    spieltage_collection: SpieltageCollection,
    teams_collection: TeamsCollection,
    today: str = Depends(get_german_date_str),
) -> FLEinladungAnsichtResponse:
    """
    Answer what this registration link is for: the team, its school, the season, and what the form may offer.

    A POST because the link value travels in the body and never in a path the edge would log. A shut
    window is a STATE here rather than a refusal, so a link opened after the deadline reads as closed
    rather than as invalid; only a link that opens no live invite is refused.
    """

    einladung_raw = await _open_einladung(einladungen_collection=einladungen_collection, token=ansicht_data.token)

    saison_id = str(einladung_raw["saison_id"])
    team_id = einladung_raw["team_id"]

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=SAISON_PROJECTION)
    rules = saison_raw.get("rules") or {}

    # The junction row's own copy of the name, as every season-scoped read serves it: a club renamed
    # after this season finished still reads here under the name it plays the season under.
    junction_raw = await saison_teams_collection.find_one({"saison_id": saison_id, "team_id": team_id}, {"name": 1})
    # The club itself for `full_name`, which the consent copy renders and the junction does not hold.
    team_raw = await pull_one_from_db(collection=teams_collection, db_filter={"_id": team_id}, projection=["name", "full_name"])

    squad_size = await saison_spieler_collection.count_documents(_live_squad_filter(saison_id=saison_id, team_id=team_id))

    # The squad create's own test, so the page tells a pupil what an entry made TODAY would store --
    # not what a squad row written on a later day will.
    nachnominierung = await nachnominierung_laeuft_in(spieltage_collection=spieltage_collection, saison_id=saison_id, today=today, session=None)

    return FLEinladungAnsichtResponse(
        team=str((junction_raw or team_raw)["name"]),
        schule=str(team_raw["full_name"]),
        saison_id=saison_id,
        saison_status=saison_raw["status"],
        laeuft=saison_nimmt_registrierungen_an(saison_status=saison_raw["status"], registrierung=saison_raw.get("registrierung"), today=today),
        erlaubte_stufen=list(rules.get("erlaubte_stufen") or []),
        # The same junction row the submission judges `registrierung_geschlossen` on, so the page words
        # the state before anything is typed rather than after a whole form is filled in.
        team_eingetragen=junction_raw is not None,
        kader_frei=squad_size < int(rules.get("max_kadergroesse") or 0),
        nachnominierung=nachnominierung,
    )


def _answer_as_the_first(*, stored: Mapping[str, Any], fingerabdruck: str) -> FLPostRegistrierungResponse:
    """The answer a stored key gets: the registration it already holds, whose mail its first press owed, never a second one."""

    refuse(find_abweichender_fingerabdruck_refusal(gespeichert=stored.get("idempotenz_fingerabdruck"), fingerabdruck=fingerabdruck))

    return FLPostRegistrierungResponse(registrierung_id=stored["_id"])


@router.post(
    "",
    response_model=FLPostRegistrierungResponse,
    status_code=201,
    summary="Register through a team's link",
)
async def post_registrierung(
    registrierung_data: Annotated[FLPostRegistrierungPayload, Body()],
    registrierungen_collection: RegistrierungenCollection,
    einladungen_collection: EinladungenCollection,
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    postausgang_collection: PostausgangCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    # Version 4 alone: a guessable key lets a stranger store other details under it first, and the
    # pupil's own press is then refused as a changed replay.
    # Optional, so a page loaded before the form sent one still submits, unprotected.
    idempotency_key: Annotated[UUID4 | None, Header()] = None,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLPostRegistrierungResponse:
    """
    Store one pupil's registration for the team and season the link belongs to, and owe its confirmation mail.

    Everything the league decides -- the team, the season, `status`, `eingereicht_am` and the
    deadline -- is taken off the invite and the clock and never off the payload. The mail is owed in
    the Postausgang in the same transaction, its link minted when it is handed out; no token is answered.

    An `Idempotency-Key` header makes a second press safe. A key already stored answers with the
    registration it holds, stores none and owes no second mail. The same key over other details is refused
    (`registrierung_schluessel_abweichend`). A key whose registration the team has since admitted is refused too
    (`registrierung_schon_aufgenommen`) and stores nothing: the pupil is in the squad.
    """

    schluessel = None if idempotency_key is None else str(idempotency_key)
    fingerabdruck = payload_fingerabdruck(registrierung_data)

    # Hashed outside the transaction: it reads no document, and `with_transaction` may run its
    # callback again.
    gehasht = sperrliste.hash_of(str(registrierung_data.email))

    # The REFERENCE season a ban is counted from, and never the invite's: a ban covers the seasons
    # following the one it was entered in, so counting from a link for a future season lifts it early.
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def store_or_replay(session: AsyncClientSession) -> FLPostRegistrierungResponse:
        """The replay, or every refusal in the flow's order and then the one write, in one transaction.

        The ban is asked with this transaction's session, so a lift racing a submission is ordered
        rather than read twice.
        """

        # Before every judgement: a replay answers what the first request did, even where the invite
        # has been revoked or the window has closed since.
        stored = (
            None
            if schluessel is None
            else await registrierungen_collection.find_one(
                build_schluessel_filter(schluessel=schluessel), WIEDERHOLUNG_PROJECTION, session=session
            )
        )
        if stored is not None:
            return _answer_as_the_first(stored=stored, fingerabdruck=fingerabdruck)

        # The admission carries the key onto the squad row it writes, so a press replayed after it is
        # still a replay rather than the pupil's second registration.
        aufgenommen = (
            None
            if schluessel is None
            else await saison_spieler_collection.find_one(
                build_schluessel_filter(schluessel=schluessel), ["idempotenz_fingerabdruck"], session=session
            )
        )
        if aufgenommen is not None:
            refuse(find_schon_aufgenommen_refusal(gespeichert=aufgenommen.get("idempotenz_fingerabdruck"), fingerabdruck=fingerabdruck))

        einladung_raw = await _open_einladung(einladungen_collection=einladungen_collection, token=registrierung_data.token, session=session)
        saison_id = str(einladung_raw["saison_id"])
        team_id = einladung_raw["team_id"]

        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": saison_id}, projection=SAISON_PROJECTION, session=session
        )
        rules = saison_raw.get("rules") or {}
        refuse(find_fenster_refusal(saison_status=saison_raw["status"], registrierung=saison_raw.get("registrierung"), today=today))

        # The ROW rather than a count: the answer's `team` is the junction's own copy of the name,
        # which the confirmation mail addresses the pupil by, and one read serves both.
        junction_raw = await saison_teams_collection.find_one({"saison_id": saison_id, "team_id": team_id}, {"name": 1}, session=session)
        refuse(find_team_junction_refusal(entered=junction_raw is not None))

        refuse(find_stufe_refusal(stufe=registrierung_data.stufe, erlaubte_stufen=list(rules.get("erlaubte_stufen") or [])))

        squad_size = await saison_spieler_collection.count_documents(_live_squad_filter(saison_id=saison_id, team_id=team_id), session=session)
        refuse(find_kader_refusal(squad_size=squad_size, max_kadergroesse=int(rules.get("max_kadergroesse") or 0)))

        gesperrt = await hash_gesperrt(
            sperrliste,
            gehasht,
            # Read before this transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
            massgebliche_saison_id=massgebliche_saison_id,
            session=session,
        )
        refuse(find_gesperrt_refusal(gesperrt=gesperrt))

        frist = days_after(day=today, days=REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE)

        created = await post_one_to_db(
            collection=registrierungen_collection,
            document={
                **compose_registrierung(
                    saison_id=saison_id,
                    team_id=team_id,
                    einladung_id=einladung_raw["_id"],
                    vorname=registrierung_data.vorname,
                    nachname=registrierung_data.nachname,
                    email=str(registrierung_data.email),
                    position=registrierung_data.position,
                    nummer=registrierung_data.nummer,
                    stufe=registrierung_data.stufe,
                    bestaetigung=compose_bestaetigung(today=today, frist=frist),
                    today=today,
                ),
                **({} if schluessel is None else {"idempotenz_schluessel": schluessel, "idempotenz_fingerabdruck": fingerabdruck}),
            },
            session=session,
        )
        registrierung_id = created.inserted_id

        await enqueue_mails(
            postausgang_collection=postausgang_collection,
            session=session,
            mails=[
                OwedMail(
                    schluessel=f"{Collection.REGISTRIERUNGEN}/{registrierung_id}/bestaetigung",
                    an=str(registrierung_data.email),
                    daten=FLRegistrierungLinkDaten(
                        art="registrierung_bestaetigung",
                        # Off the invite the token opened, never the body: anyone holding the link could otherwise word the
                        # league's message. `or {}` for the type checker alone: `refuse` above has raised where the row is missing.
                        team=str((junction_raw or {}).get("name", "")),
                        saison_id=saison_id,
                        frist_tage=REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE,
                    ),
                    bezug=FLPostausgangBezug(sammlung=Collection.REGISTRIERUNGEN, id=registrierung_id, sitz=None),
                    link=REGISTRIERUNG_LINK,
                )
            ],
            now=germany_now,
        )

        return FLPostRegistrierungResponse(registrierung_id=registrierung_id)

    # The key lookup is the transaction's first read: a first press committed before this snapshot is
    # found, and one committed after it makes the insert a write conflict `with_transaction` retries.
    async with transaction_session(db) as session:
        return await session.with_transaction(store_or_replay)


# The confirmation link's two endpoints: the token is the whole credential, so both are base-tier as
# the submission is.
@router.post(
    "/bestaetigung/ansicht",
    response_model=FLRegistrierungBestaetigungAnsichtResponse,
    summary="What one registration confirmation link opens",
)
async def get_bestaetigung_ansicht(
    ansicht_data: Annotated[FLTokenPayload, Body()],
    registrierungen_collection: RegistrierungenCollection,
    teams_collection: TeamsCollection,
    spieler_collection: SpielerCollection,
    sperrliste: SperrlisteLookup,
    today: str = Depends(get_german_date_str),
) -> FLRegistrierungBestaetigungAnsichtResponse:
    """What the confirmation page renders for the registration this token opens, and nothing of the pupil.

    A POST, so the token travels in the body. A confirmed or expired link is served in that state, `gesperrt` ranking first,
    and `bestaetigung_spieler_wiederkehrend` opens the returning pupil's page; only a token no registration holds is refused
    (`link_ungueltig`).
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
    "/bestaetigung",
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
    """Record a pupil's own answer for the registration their link opens, which stays pending until the team decides.

    Refuses, writing nothing: `link_ungueltig`, `link_abgelaufen`, `bestaetigung_vorhanden`, `bestaetigung_alter`, `medien_alter`,
    `link_gesperrt`, `registrierung_wahlen_unpassend` and `fassung_unzulaessig`.
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
        # Exactly one of the two is set once the refusals above have passed: every stored person carries a birthdate.
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
