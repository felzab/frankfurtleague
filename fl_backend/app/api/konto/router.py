from fastapi import APIRouter, Depends

from app.api.identitaet.crud import funktionen_of
from app.api.identitaet.lookup import SubjektLookup
from app.api.identitaet.services import ist_eigener_schiedsrichter, ist_eigener_spieler, may_grant_on_schiedsrichter, may_grant_on_spieler
from app.api.konto.schemas import FLKontoEinwilligungenResponse
from app.api.konto.services import (
    build_angenommene_bewerbungen_pipeline,
    build_kontext_teams_pipeline,
    build_selbst_bewerbung_pipeline,
    build_selbst_registrierung_pipeline,
    build_selbst_seat_pipeline,
    compose_bewerbungssitze_selbst,
    compose_registrierungen_selbst,
    compose_schiedsrichter_konto,
    compose_sitze_selbst,
    compose_spieler_konto,
    kontext_zeile,
)
from app.api.schiedsrichter.services import build_selbst_referee_pipeline
from app.api.spieler.services import build_selbst_pupil_pipeline
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db
from app.core.dependencies import (
    BewerbungenCollection,
    DBClient,
    RegistrierungenCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielerCollection,
    TeamsCollection,
    get_german_date_str,
)
from app.core.security import PERSON_ACTOR_BINDERS, KontaktIdentifier, verify_access_admin

# Every person binder fixes a Funktion and this page is none's: `kontakt` is bound, its seat control
# having no page of its own. Nothing here writes, so no record carries it; a write belongs on its
# record's own router.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/konto",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["kontakt"])],
)


@router.get("/einwilligungen", response_model=FLKontoEinwilligungenResponse, summary="A signed-in person's own consent records")
async def get_einwilligungen(
    identifier: KontaktIdentifier,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    saison_teams_collection: SaisonTeamsCollection,
    teams_collection: TeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    registrierungen_collection: RegistrierungenCollection,
    records: SubjektLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLKontoEinwilligungenResponse:
    """
    Answer every confirmed consent record the signed-in address holds, its pupil, referee and contact-seat records alike.

    The seats come one entry per team season on which the address holds a confirmed seat, however many of its slots;
    `bewerbungen` one per PENDING application on which it does, whose two choices the account page may only withdraw;
    `registrierungen` one per pending registration its pupil confirmed, withdraw-only alike until the admission; a
    returning pupil's asked no choice, so it serves its stored data with both choices null and offers nothing to press.

    PERSON TIER, for the account page, which every signed-in person reaches: an address holding nothing is answered
    `spieler: null` and four empty lists, never refused. A retired record, a past season's seat and a withdrawn team's
    seat are served too, a withdrawal staying open wherever a consent stands; `kontext` carries what the record's
    confirmation page filled its words with, as those records stand today; `erteilbar` says whether a grant is
    admitted, `medien_angeboten` whether the media consent may be switched on. A record awaiting its person's
    confirmation is not served: there is nothing on it yet to change.
    """

    # A snapshot, so every record is answered as of one moment; never a transaction, which a read
    # writing nothing has no conflict to retry for.
    async with db.start_session(snapshot=True) as session:
        pupils = await aggregate_many_from_db(collection=spieler_collection, pipeline=build_selbst_pupil_pipeline(identifier), session=session)
        referees = await aggregate_many_from_db(
            collection=schiedsrichter_collection, pipeline=build_selbst_referee_pipeline(identifier), session=session
        )
        seat_rows = await aggregate_many_from_db(
            collection=saison_teams_collection, pipeline=build_selbst_seat_pipeline(identifier), session=session
        )
        bewerbung_rows = await aggregate_many_from_db(
            collection=bewerbungen_collection, pipeline=build_selbst_bewerbung_pipeline(identifier), session=session
        )
        registrierung_rows = await aggregate_many_from_db(
            collection=registrierungen_collection, pipeline=build_selbst_registrierung_pipeline(identifier), session=session
        )
        subjekt = await funktionen_of(identifier, records, session=session)

        pupil = next((row for row in pupils if ist_eigener_spieler(row)), None)
        zeile = None if pupil is None else kontext_zeile(pupil)
        team_ids = [
            *([] if zeile is None else [zeile["team_id"]]),
            *(row["team_id"] for row in seat_rows),
            # A school applying as a club the league already holds names it by `team_id` alone.
            *(row["team_id"] for row in bewerbung_rows if row.get("team_id") is not None),
            *(row["team_id"] for row in registrierung_rows),
        ]
        teams = {
            team["_id"]: team
            for team in await aggregate_many_from_db(
                collection=teams_collection, pipeline=build_kontext_teams_pipeline(team_ids), session=session
            )
        }
        bewerbungen = {
            (bewerbung["team_id"], bewerbung["saison_id"]): bewerbung
            for bewerbung in await aggregate_many_from_db(
                collection=bewerbungen_collection,
                pipeline=build_angenommene_bewerbungen_pipeline([row["team_id"] for row in seat_rows]),
                session=session,
            )
        }

        return FLKontoEinwilligungenResponse.model_validate(
            {
                "spieler": None
                if pupil is None
                else compose_spieler_konto(
                    pupil,
                    erteilbar=may_grant_on_spieler(subjekt, pupil["_id"]),
                    today=today,
                    team=None if zeile is None else teams.get(zeile["team_id"]),
                ),
                "schiedsrichter": [
                    compose_schiedsrichter_konto(row, erteilbar=may_grant_on_schiedsrichter(subjekt, row["_id"]), today=today)
                    for row in referees
                    if ist_eigener_schiedsrichter(row, identifier)
                ],
                "sitze": compose_sitze_selbst(
                    seat_rows, identifier, sitze_mit_panel=subjekt.sitze, today=today, teams=teams, bewerbungen=bewerbungen
                ),
                "bewerbungen": compose_bewerbungssitze_selbst(bewerbung_rows, identifier, teams=teams),
                "registrierungen": compose_registrierungen_selbst(registrierung_rows, identifier, teams=teams),
            }
        )
