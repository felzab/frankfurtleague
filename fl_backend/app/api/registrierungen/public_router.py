from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Header
from pydantic import UUID4
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.services import build_schluessel_filter, days_after, hash_token, payload_fingerabdruck
from app.api.einladungen.services import find_live_einladung_filter, find_unknown_einladung_refusal
from app.api.postausgang.schemas import FLPostausgangBezug, FLPostausgangLink, FLRegistrierungLinkDaten
from app.api.postausgang.services import enqueue_mail
from app.api.registrierungen.schemas import (
    FLEinladungAnsichtResponse,
    FLPostRegistrierungPayload,
    FLPostRegistrierungResponse,
)
from app.api.registrierungen.services import (
    compose_bestaetigung,
    compose_registrierung,
    find_abweichender_fingerabdruck_refusal,
    find_fenster_refusal,
    find_gesperrt_refusal,
    find_kader_refusal,
    find_schon_aufgenommen_refusal,
    find_stufe_refusal,
    find_team_junction_refusal,
    saison_nimmt_registrierungen_an,
)
from app.api.sperrliste.lookup import SperrlisteLookup, hash_gesperrt, sperrliste_saison
from app.api.spieltage.crud import nachnominierung_laeuft_in
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import post_one_to_db, pull_one_from_db, refuse
from app.core.dependencies import (
    DBClient,
    EinladungenCollection,
    PostausgangCollection,
    RegistrierungenCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SpieltageCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.security import bind_public_actor, verify_access_base
from app.core.transactions import transaction_session
from app.shared.schemas.bestaetigung import FLTokenPayload
from app.shared.schemas.bounds import REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE

# `bind_public_actor`, never `bind_actor`: no browser sends `X-FL-Actor`, so that guard would refuse
# every registration with `REQ-AUTH-005`. The write still passes `app/core/crud.py`, and an insert
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

    ONE code for unknown and for revoked, the reason `REQ-BEWERBUNG-009` records: nothing tells a
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
        # The same junction row the submission judges `REQ-REGISTRIERUNG-002` on, so the page words
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
    (`REQ-REGISTRIERUNG-011`). A key whose registration the team has since admitted is refused too
    (`REQ-REGISTRIERUNG-016`) and stores nothing: the pupil is in the squad.
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

        await enqueue_mail(
            postausgang_collection=postausgang_collection,
            session=session,
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
            now=germany_now,
            bezug=FLPostausgangBezug(sammlung=Collection.REGISTRIERUNGEN, id=registrierung_id, sitz=None),
            link=FLPostausgangLink(pfad="bestaetigung.token_hashes", ersetzt=False),
        )

        return FLPostRegistrierungResponse(registrierung_id=registrierung_id)

    # The key lookup is the transaction's first read: a first press committed before this snapshot is
    # found, and one committed after it makes the insert a write conflict `with_transaction` retries.
    async with transaction_session(db) as session:
        return await session.with_transaction(store_or_replay)
