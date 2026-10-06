from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.einwilligung.services import find_selbst_medien_refusal
from app.api.identitaet.crud import funktionen_of, refuse_without_a_seat
from app.api.identitaet.lookup import SubjektLookup
from app.api.identitaet.services import eigene_sitze, seat_is_confirmed
from app.api.kontakte.services import KONTAKT_SLOTS
from app.api.konto.services import (
    KONTO_SEITE_KONTAKT,
    SITZ_WAHLEN,
    compose_selbst_einwilligung_move,
    erteilt_etwas,
    find_eigener_eintrag_refusal,
    find_konto_fassung_refusal,
    find_nachweis_stand_refusal,
)
from app.api.teams.schemas import (
    FLSaisonTeamPersonEinwilligungPayload,
    FLSaisonTeamPersonEinwilligungResponse,
    FLTeamSitz,
    FLTeamSitzeResponse,
)
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import (
    DBClient,
    SaisonTeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.drosselung import Drossel
from app.core.recording import log_stamp
from app.core.security import PERSON_ACTOR_BINDERS, KontaktIdentifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_nachweis import nachweis_stand_of
from app.shared.schemas.custom import CustomRouteObjectId

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
# and `fl_backend/tests/api/test_admin_guard.py` fails at collection on two routes serving one operation.
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
            [f"kontakte.{slot}.{field}" for slot in KONTAKT_SLOTS for field in ("vorname", "nachname", "einwilligung.bestaetigt_am")],
            session=session,
        )
        kontakte = (row or {}).get("kontakte") or {}

    return FLTeamSitzeResponse(team_id=team_id, saison_id=saison_id, sitze=[_as_sitz(kontakte, slot) for slot in KONTAKT_SLOTS])


@router.patch(
    "/{team_id:objectid}/saisons/{saison_id}/person/einwilligung",
    response_model=FLSaisonTeamPersonEinwilligungResponse,
    summary="Change a seat holder's own media consent on one team's season",
)
async def patch_einwilligung(
    team_id: CustomRouteObjectId,
    saison_id: str,
    einwilligung_data: Annotated[FLSaisonTeamPersonEinwilligungPayload, Body()],
    identifier: KontaktIdentifier,
    saison_teams_collection: SaisonTeamsCollection,
    records: SubjektLookup,
    db: DBClient,
    drossel: Drossel,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLSaisonTeamPersonEinwilligungResponse:
    """
    Set the signed-in person's media consent on every seat they hold on this team's season row, and on nothing else.

    One answer for all of them: a person holding two of the row's slots answers once. No other slot of the row, no
    other row and the seats' contact scope are written; a press moving no seat writes nothing. A GRANT (`medien` to
    `true`) is taken on a row of an `active` or `future` season its team has not left; a withdrawal on any row the
    person confirmed a seat on, a past season's included.

    Refuses, in this order: a row on which the address holds no confirmed seat, or a grant where the row grants no
    panel (`REQ-FUNKTION-001`); a `nachweis_stand` other than the held seats' own, their media evidence having moved
    since the page was served (`REQ-EINWILLIGUNG-003`); a `text_version` naming no version of the account page's seat control, or a grant
    naming any but its running one (`REQ-EINWILLIGUNG-001`); `medien` moving to `true` where a held seat's stored
    birthdate does not reach `MEDIEN_MIN_AGE_YEARS` today or is missing (`REQ-EINWILLIGUNG-002`); and a grant past the
    person's ceiling for the German day (`REQ-DROSSELUNG-001`), which counts grants alone, so a withdrawal is never
    refused for it. Each refusal writes nothing.
    """

    async def write(session: AsyncClientSession) -> FLSaisonTeamPersonEinwilligungResponse:
        row = await saison_teams_collection.find_one(
            {"saison_id": saison_id, "team_id": team_id},
            {f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_SLOTS for field in ("email", "geburtsdatum", "einwilligung")},
            session=session,
        )
        rollen = [] if row is None else eigene_sitze(row, identifier)
        refuse(find_eigener_eintrag_refusal(gehalten=bool(rollen)))
        assert row is not None
        sitze = {slot: row["kontakte"][slot] for slot in rollen}
        refuse(
            find_nachweis_stand_refusal(
                erwartet=einwilligung_data.nachweis_stand.model_dump(),
                bloecke=[sitz["einwilligung"] for sitz in sitze.values()],
                wahlen=SITZ_WAHLEN,
            )
        )

        erteilt = any(erteilt_etwas(gespeichert=sitz["einwilligung"], umfang=None, medien=einwilligung_data.medien) for sitz in sitze.values())
        if erteilt:
            subjekt = await funktionen_of(identifier, records, session=session)
            # The panel narrowing a grant waits on: a `past` season's seat and a withdrawn team's grant none.
            refuse(
                find_eigener_eintrag_refusal(gehalten=any(sitz.team_id == team_id and sitz.saison_id == saison_id for sitz in subjekt.sitze))
            )

        refuse(find_konto_fassung_refusal(seite=KONTO_SEITE_KONTAKT, text_version=einwilligung_data.text_version, erteilt=erteilt))
        # Every held seat moving to `true`, each on its own stored birthdate.
        for sitz in sitze.values():
            refuse(
                find_selbst_medien_refusal(
                    geburtsdatum=sitz.get("geburtsdatum"),
                    medien_erteilt=einwilligung_data.medien and sitz["einwilligung"].get("medien") is not True,
                    today=today,
                )
            )
        # Last, so a press another rule refuses spends nothing; and a grant alone, so taking a consent
        # back stays as easy as giving it was (Art. 7(3) DSGVO).
        if erteilt:
            await drossel()

        update = compose_selbst_einwilligung_move(
            bloecke=tuple((f"kontakte.{slot}.einwilligung", sitz["einwilligung"]) for slot, sitz in sitze.items()),
            umfang=None,
            medien=einwilligung_data.medien,
            am=log_stamp(germany_now),
            text_version=einwilligung_data.text_version,
        )
        bloecke = [sitz["einwilligung"] for sitz in sitze.values()]
        if update is not None:
            updated = await patch_one_in_db(
                collection=saison_teams_collection,
                db_filter={"_id": row["_id"]},
                update=update,
                session=session,
                return_document=ReturnDocument.AFTER,
            )
            bloecke = [updated["kontakte"][slot]["einwilligung"] for slot in rollen]

        # Every held seat holds the payload's answer now, the ones the press moved and the ones it found so.
        return FLSaisonTeamPersonEinwilligungResponse.model_validate(
            {
                "team_id": team_id,
                "saison_id": saison_id,
                "rollen": rollen,
                "medien": einwilligung_data.medien,
                "nachweis_stand": nachweis_stand_of(bloecke=bloecke, wahlen=SITZ_WAHLEN),
            }
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(write)
