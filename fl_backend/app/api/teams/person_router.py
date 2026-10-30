from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.identitaet.crud import funktionen_of, refuse_without_a_seat
from app.api.identitaet.lookup import SubjektLookup
from app.api.identitaet.services import eigene_sitze, holds_a_seat, seat_is_confirmed
from app.api.konto.crud import press_einwilligung
from app.api.konto.services import (
    KONTO_SEITE_KONTAKT,
    compose_sitz_move,
    find_eigener_eintrag_refusal,
    geaenderte_sitz_wahlen,
    sitz_wahlen_der_zeile,
    widerruf_line,
)
from app.api.teams.schemas import FLSaisonTeamPersonEinwilligungResponse, FLTeamSitz, FLTeamSitzeResponse
from app.core.collections import Collection
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import (
    DBClient,
    SaisonTeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.journal import Journal
from app.core.recording import log_stamp
from app.core.security import PERSON_ACTOR_BINDERS, KontaktIdentifier, loeschung_journal_hash, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_nachweis import FLEinwilligungWahl, nachweis_stand_of
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.einwilligung import FLSitzEinwilligungPayload
from app.shared.schemas.literals import KONTAKT_ROLLEN

# The person lane's binder, as `app/api/registrierungen/person_router.py` declares it and for its reason.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/teams",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["kontakt"])],
)


def _as_sitz(kontakte: Mapping[str, Any], slot: str) -> FLTeamSitz:
    person = kontakte.get(slot)
    if not isinstance(person, Mapping):
        return FLTeamSitz.model_validate({"rolle": slot, "name": None, "bestaetigt": False})

    return FLTeamSitz.model_validate(
        {
            "rolle": slot,
            "name": " ".join(str(person.get(field) or "").strip() for field in ("vorname", "nachname")).strip() or None,
            "bestaetigt": seat_is_confirmed({"kontakte": kontakte}, slot),
        }
    )


# `/person/sitze`, its own segment: the admin router serves this team and season under its own paths,
# and one path in both routers would be answered by whichever was mounted first.
@router.get("/{team_id:objectid}/saisons/{saison_id}/person/sitze", response_model=FLTeamSitzeResponse, summary="A team's seats in one season")
async def get_team_sitze(
    team_id: CustomRouteObjectId,
    saison_id: str,
    identifier: KontaktIdentifier,
    saison_teams_collection: SaisonTeamsCollection,
    records: SubjektLookup,
    db: DBClient,
) -> FLTeamSitzeResponse:
    """
    The team's three seats in this season, each with its holder's name and whether that person has confirmed it.

    Always three lines, an empty slot answered with no name. No seat's address, telephone number, birthdate or
    confirmation date is served, whoever asks.
    """

    # A snapshot rather than a transaction, for `get_offene_registrierungen`'s reason.
    async with db.start_session(snapshot=True) as session:
        await refuse_without_a_seat(identifier, records, team_id=team_id, saison_id=saison_id, session=session)

        # The seat just judged lives on this row, read in the same snapshot, so it stands and no 404 is owed.
        row = await saison_teams_collection.find_one(
            {"saison_id": saison_id, "team_id": team_id},
            [f"kontakte.{slot}.{field}" for slot in KONTAKT_ROLLEN for field in ("vorname", "nachname", "einwilligung.bestaetigt_am")],
            session=session,
        )
        kontakte = (row or {}).get("kontakte") or {}

    return FLTeamSitzeResponse(team_id=team_id, saison_id=saison_id, sitze=[_as_sitz(kontakte, slot) for slot in KONTAKT_ROLLEN])


@router.patch(
    "/{team_id:objectid}/saisons/{saison_id}/person/einwilligung",
    response_model=FLSaisonTeamPersonEinwilligungResponse,
    summary="Change a seat holder's own WhatsApp and media consent on one team's season",
)
async def patch_einwilligung(
    team_id: CustomRouteObjectId,
    saison_id: str,
    einwilligung_data: Annotated[FLSitzEinwilligungPayload, Body()],
    identifier: KontaktIdentifier,
    saison_teams_collection: SaisonTeamsCollection,
    records: SubjektLookup,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLSaisonTeamPersonEinwilligungResponse:
    """
    Set the signed-in person's two consents on every seat they hold on this team's season row: WhatsApp and media.

    One answer for all of them: a person holding two of the row's slots answers once, each choice moving only where it
    differs from the row as the page served it, so seats answered apart keep their answers to a choice not changed. No
    other slot of the row and no other row is written, each choice moving with its own evidence and leaving the
    other standing; a press moving no seat writes nothing. A GRANT (`umfang` to `kontaktdaten_whatsapp` or `medien`
    to `true`) is taken on a row of an `active` or `future` season its team has not left; a withdrawal on any row the
    person confirmed a seat on, a past season's included.

    Refuses, in this order: a row on which the address holds no confirmed seat (`REQ-FUNKTION-001`); a
    `nachweis_stand` other than the held seats' own, either choice having moved since the page was served
    (`REQ-EINWILLIGUNG-003`); a grant where the row grants no panel (`REQ-EINWILLIGUNG-004`); a `text_version` naming no
    version of the account page's seat control, or a grant naming any but its running one (`REQ-EINWILLIGUNG-001`);
    `medien` moving to `true` where a held seat's stored birthdate does not reach `MEDIEN_MIN_AGE_YEARS` today or is
    missing (`REQ-EINWILLIGUNG-002`). Each refusal writes nothing.
    """

    gedrueckt: dict[FLEinwilligungWahl, object] = {"umfang": einwilligung_data.umfang, "medien": einwilligung_data.medien}
    # For `app/api/spieler/selbst_router.py :: patch_einwilligung`'s reason: a replay stamps the moment the person pressed.
    am = log_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def write(session: AsyncClientSession) -> FLSaisonTeamPersonEinwilligungResponse:
        row = await saison_teams_collection.find_one(
            {"saison_id": saison_id, "team_id": team_id},
            {f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in ("email", "geburtsdatum", "einwilligung")},
            session=session,
        )
        rollen = [] if row is None else eigene_sitze(row, identifier)
        refuse(find_eigener_eintrag_refusal(gehalten=bool(rollen)))
        assert row is not None
        sitze = {slot: row["kontakte"][slot] for slot in rollen}
        gewaehlt = geaenderte_sitz_wahlen(bloecke=[sitz["einwilligung"] for sitz in sitze.values()], gedrueckt=gedrueckt)

        async def darf_erteilen() -> bool:
            # The panel narrowing a grant waits on: a `past` season's seat and a withdrawn team's grant none.
            subjekt = await funktionen_of(identifier, records, session=session)
            return holds_a_seat(subjekt.sitze, team_id=team_id, saison_id=saison_id)

        await press_einwilligung(
            bloecke=[sitz["einwilligung"] for sitz in sitze.values()],
            geburtsdaten=[sitz.get("geburtsdatum") for sitz in sitze.values()],
            gewaehlt=gewaehlt,
            nachweis_stand=einwilligung_data.nachweis_stand.model_dump(),
            text_version=einwilligung_data.text_version,
            seite=KONTO_SEITE_KONTAKT,
            darf_erteilen=darf_erteilen,
            today=today,
        )

        update = compose_sitz_move(
            sitze={slot: sitz["einwilligung"] for slot, sitz in sitze.items()},
            gewaehlt=gewaehlt,
            am=am,
            text_version=einwilligung_data.text_version,
        )
        updated = (
            None
            if update is None
            else await patch_one_in_db(
                collection=saison_teams_collection,
                db_filter={"_id": row["_id"]},
                update=update,
                session=session,
                return_document=ReturnDocument.AFTER,
            )
        )
        line = widerruf_line(
            person_hash=loeschung_journal_hash(identifier, schluessel=config.sperrliste_schluessel),
            collection=Collection.SAISON_TEAMS,
            record_id=row["_id"],
            bloecke=[sitz["einwilligung"] for sitz in sitze.values()],
            gewaehlt=gewaehlt,
            am=am,
            text_version=einwilligung_data.text_version,
        )
        if line is not None:
            journal.note(line)
        kontakte = row["kontakte"] if updated is None else updated["kontakte"]
        bloecke = [kontakte[slot]["einwilligung"] for slot in rollen]

        # The row as the next read serves it: an unpressed choice its seats answered apart stays apart.
        return FLSaisonTeamPersonEinwilligungResponse.model_validate(
            {
                "team_id": team_id,
                "saison_id": saison_id,
                "rollen": rollen,
                **sitz_wahlen_der_zeile(bloecke),
                "nachweis_stand": nachweis_stand_of(bloecke=bloecke),
            }
        )

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(write)
