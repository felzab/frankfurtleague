from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.saisons.schemas import FLSaisonRules
from app.api.spieler.schemas import FLSpielerRolle
from app.api.spieler.services import (
    build_live_rolle_filter,
    build_live_squad_filter,
    find_squad_capacity_refusal,
    find_squad_rolle_refusal,
)
from app.core.crud import anchor_in_db, pull_one_from_db, refuse
from app.shared.schemas.custom import CustomObjectId


async def refuse_a_full_squad(
    *,
    saison_spieler_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    saison_id: str,
    team_id: CustomObjectId,
    spieler_id: CustomObjectId,
    # REQUIRED: the anchor below is what closes the race, so forgetting the session has to be a
    # TypeError at the call rather than a silent reopening of it.
    session: AsyncClientSession,
) -> None:
    """Refuse `REQ-SQUAD-003` when this team's squad for this season is already at the season's cap.

    Shared by create, transfer and reactivate: the cap is a property of the DESTINATION squad, not
    of the verb.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["rules"], session=session)

    # A count is a read, which a snapshot re-validates nowhere, so two writers pass one figure
    # unless something puts them in one write set.

    await anchor_in_db(
        collection=saisons_collection,
        db_filter={"_id": saison_id},
        session=session,
    )

    squad_size = await saison_spieler_collection.count_documents(
        build_live_squad_filter(saison_id=saison_id, team_id=team_id, excluding_spieler_id=spieler_id), session=session
    )

    refuse(
        find_squad_capacity_refusal(
            squad_size=squad_size,
            # Validated, not read raw: a season missing the key fails here rather than admitting a
            # player against a bound nobody chose.
            max_kadergroesse=FLSaisonRules.model_validate(saison_raw["rules"]).max_kadergroesse,
        )
    )


async def refuse_a_taken_rolle(
    *,
    saison_spieler_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    saison_id: str,
    team_id: CustomObjectId,
    spieler_id: CustomObjectId,
    rolle: FLSpielerRolle | None,
    # REQUIRED for `refuse_a_full_squad`'s reason: the anchor below closes the race.
    session: AsyncClientSession,
) -> None:
    """Refuse `REQ-SQUAD-004` when another live row in this squad already holds `rolle`.

    Shared by every squad write for the reason the cap is: the role belongs to the DESTINATION squad,
    never to the verb.
    """

    # Before the anchor: a row holding no role competes with nobody, so there is no count to protect.
    if rolle is None:
        return

    # Its own anchor rather than the cap's: a caller running this without `refuse_a_full_squad` --
    # a representative's edit, which cannot cross the cap -- would otherwise let two captains through.
    await anchor_in_db(
        collection=saisons_collection,
        db_filter={"_id": saison_id},
        session=session,
    )

    taken = (
        await saison_spieler_collection.count_documents(
            build_live_rolle_filter(saison_id=saison_id, team_id=team_id, rolle=rolle, excluding_spieler_id=spieler_id),
            limit=1,
            session=session,
        )
    ) > 0

    refuse(find_squad_rolle_refusal(rolle=rolle, taken=taken))
