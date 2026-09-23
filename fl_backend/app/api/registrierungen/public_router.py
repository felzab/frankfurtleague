from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.results import InsertOneResult

from app.api.bewerbungen.services import days_after, hash_token, mint_token
from app.api.einladungen.services import find_live_einladung_filter, find_unknown_einladung_refusal, registrierungsfenster_laeuft
from app.api.registrierungen.schemas import (
    FLEinladungAnsichtPayload,
    FLEinladungAnsichtResponse,
    FLPostRegistrierungPayload,
    FLPostRegistrierungResponse,
)
from app.api.registrierungen.services import (
    compose_bestaetigung,
    compose_registrierung,
    find_fenster_refusal,
    find_gesperrt_refusal,
    find_kader_refusal,
    find_stufe_refusal,
    find_team_junction_refusal,
)
from app.api.saisons.crud import pull_massgebliche_saison_id
from app.api.sperrliste.crud import address_is_gesperrt
from app.api.sperrliste.services import adresse_hash
from app.api.spieltage.crud import nachnominierung_laeuft_in
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import post_one_to_db, pull_one_from_db, refuse
from app.core.dependencies import (
    DBClient,
    EinladungenCollection,
    RegistrierungenCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SperrlisteCollection,
    SpieltageCollection,
    TeamsCollection,
    get_german_date_str,
)
from app.core.exception_handlers import stores_nothing
from app.core.security import bind_public_actor, verify_access_base
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

# `refuse_withheld_saison` is deliberately NOT called below, where every other base-tier season read
# calls it: a season taking registrations is normally `future`, so that guard would 404 the flow
# this exists for. The INVITE authorises instead (`docs/backend/spec.md :: I47`).


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
    dependencies=[Depends(stores_nothing)],
)
async def post_einladung_ansicht(
    ansicht_data: Annotated[FLEinladungAnsichtPayload, Body()],
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
        laeuft=registrierungsfenster_laeuft(registrierung=saison_raw.get("registrierung"), today=today),
        erlaubte_stufen=list(rules.get("erlaubte_stufen") or []),
        # The same junction row the submission judges `REQ-REGISTRIERUNG-002` on, so the page words
        # the state before anything is typed rather than after a whole form is filled in.
        team_eingetragen=junction_raw is not None,
        kader_frei=squad_size < int(rules.get("max_kadergroesse") or 0),
        nachnominierung=nachnominierung,
    )


@router.post("", response_model=FLPostRegistrierungResponse, summary="Register through a team's link")
async def post_registrierung(
    registrierung_data: Annotated[FLPostRegistrierungPayload, Body()],
    registrierungen_collection: RegistrierungenCollection,
    einladungen_collection: EinladungenCollection,
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    sperrliste_collection: SperrlisteCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    today: str = Depends(get_german_date_str),
) -> FLPostRegistrierungResponse:
    """
    Store one pupil's registration for the team and season the link belongs to, and mint the confirmation link.

    Everything the league decides -- the team, the season, `status`, `eingereicht_am` and the
    deadline -- is taken off the invite and the clock and never off the payload. The raw confirmation
    token is answered for the caller to mail and stored only as a hash; this response is the one
    place outside the recipient's inbox it ever exists.
    """

    # Hashed outside the transaction: it reads no document, and `with_transaction` may run its
    # callback again.
    gehasht = adresse_hash(str(registrierung_data.email), schluessel=config.sperrliste_schluessel)

    # The REFERENCE season a ban is counted from, and never the invite's: a ban covers the seasons
    # following the one it was entered in, so counting from a link for a future season lifts it early.
    massgebliche_saison_id = await pull_massgebliche_saison_id(saisons_collection)

    async def judge_and_store(session: AsyncClientSession) -> tuple[InsertOneResult, str, str, str, str]:
        """Every refusal in the order the flow declares them, then the one write, in one transaction.

        The ban is asked with this transaction's own session, so a lift racing a submission is
        ordered rather than read twice.
        """

        einladung_raw = await _open_einladung(einladungen_collection=einladungen_collection, token=registrierung_data.token, session=session)
        saison_id = str(einladung_raw["saison_id"])
        team_id = einladung_raw["team_id"]

        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": saison_id}, projection=SAISON_PROJECTION, session=session
        )
        rules = saison_raw.get("rules") or {}
        refuse(find_fenster_refusal(registrierung=saison_raw.get("registrierung"), today=today))

        # The ROW rather than a count: the answer's `team` is the junction's own copy of the name,
        # which the confirmation mail addresses the pupil by, and one read serves both.
        junction_raw = await saison_teams_collection.find_one({"saison_id": saison_id, "team_id": team_id}, {"name": 1}, session=session)
        refuse(find_team_junction_refusal(entered=junction_raw is not None))

        refuse(find_stufe_refusal(stufe=registrierung_data.stufe, erlaubte_stufen=list(rules.get("erlaubte_stufen") or [])))

        squad_size = await saison_spieler_collection.count_documents(_live_squad_filter(saison_id=saison_id, team_id=team_id), session=session)
        refuse(find_kader_refusal(squad_size=squad_size, max_kadergroesse=int(rules.get("max_kadergroesse") or 0)))

        gesperrt = await address_is_gesperrt(
            sperrliste_collection=sperrliste_collection,
            adresse_hash=gehasht,
            massgebliche_saison_id=massgebliche_saison_id,
            session=session,
        )
        refuse(find_gesperrt_refusal(gesperrt=gesperrt))

        # Minted here rather than in the document below, so the raw half reaches the response and the
        # hashed half the database, and the two never sit in one structure.
        raw, token_hash = mint_token()
        frist = days_after(day=today, days=REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE)

        created = await post_one_to_db(
            collection=registrierungen_collection,
            document=compose_registrierung(
                saison_id=saison_id,
                team_id=team_id,
                einladung_id=einladung_raw["_id"],
                vorname=registrierung_data.vorname,
                nachname=registrierung_data.nachname,
                email=str(registrierung_data.email),
                position=registrierung_data.position,
                nummer=registrierung_data.nummer,
                stufe=registrierung_data.stufe,
                bestaetigung=compose_bestaetigung(token_hash=token_hash, today=today, frist=frist),
                today=today,
            ),
            session=session,
        )

        # `or {}` for the type checker alone: `refuse` above has raised where the row is missing,
        # and no narrowing follows a raise inside a call.
        return created, raw, frist, str((junction_raw or {}).get("name", "")), saison_id

    async with db.start_session() as session:
        created, raw, frist, team, saison_id = await session.with_transaction(judge_and_store)

    return FLPostRegistrierungResponse(
        registrierung_id=created.inserted_id,
        bestaetigung_token=raw,
        frist=frist,
        team=team,
        saison_id=saison_id,
        email=str(registrierung_data.email),
    )
