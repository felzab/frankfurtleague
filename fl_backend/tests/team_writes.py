"""The team editor's two writes as a test drives them: its one save, and the block a seat's write stores."""

import secrets
from collections.abc import Mapping
from datetime import datetime
from typing import Any, NamedTuple

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

from app.api.ban_list.lookup import ban_list_saison
from app.api.bewerbungen.services import compose_einwilligung
from app.api.teams.admin_router import KONTAKT_WRITE_FIELDS, patch_team_saison, write_the_contact_block
from app.api.teams.schemas import FLKontaktMint, FLKontaktSeatPayload, FLPatchTeamSaisonPayload
from app.core.collections import Collection
from app.core.crud import pull_one_from_db
from app.core.transactions import transaction_session
from tests.bans import ban_list

CLUB_FIELDS = ("name", "shorthand", "description", "full_name", "schulform", "website_url", "address")


async def save_the_team(
    database: AsyncDatabase,
    *,
    team_id: Any,
    saison_id: str,
    teams_collection: Any = None,
    saison_teams_collection: Any = None,
    saisons_collection: Any = None,
    **changes: Any,
) -> Any:
    """`PATCH .../admin` on the club and its row as stored, with `changes` over them, on the count the editor would hold."""

    team = await database[Collection.TEAMS].find_one({"_id": team_id})
    row = await database[Collection.SAISON_TEAMS].find_one({"team_id": team_id, "saison_id": saison_id})
    assert team is not None and row is not None, "the seed holds no club or no row to save"

    body = {
        **{field: team[field] for field in CLUB_FIELDS},
        "gruppe": row["gruppe"],
        "trikot_farbe": row.get("trikot_farbe"),
        "version": team.get("version", 0) + row.get("version", 0),
        **changes,
    }

    return await patch_team_saison(
        team_id=team_id,
        saison_id=saison_id,
        team_data=FLPatchTeamSaisonPayload.model_validate(body),
        teams_collection=database[Collection.TEAMS] if teams_collection is None else teams_collection,
        saison_teams_collection=database[Collection.SAISON_TEAMS] if saison_teams_collection is None else saison_teams_collection,
        saisons_collection=database[Collection.SAISONS] if saisons_collection is None else saisons_collection,
        spiele_collection=database[Collection.SPIELE],
        db=database.client,
    )


class BlockWritten(NamedTuple):
    """Each person the write owed a link."""

    confirmations: list[FLKontaktMint]


def seat_sent(seat: Mapping[str, Any], *, today: str) -> dict[str, Any]:
    """One seat as `compose_seat_block` hands it on: the person as the seat write's payload takes them, under the record it bears them with."""

    sent = {field: value for field, value in seat.items() if field != "einwilligung"}
    person = FLKontaktSeatPayload.model_validate({**sent, "version": 0}).model_dump(mode="json", exclude={"version"}, exclude_unset=True)

    return {**person, "einwilligung": compose_einwilligung(today=today, entered_by="liga")}


async def write_the_block(
    database: AsyncDatabase,
    block: Mapping[str, Any],
    *,
    team_id: Any,
    saison_id: str,
    version: int,
    today: str,
    germany_now: datetime,
    saison_teams_collection: Any = None,
) -> BlockWritten:
    """What `put_kontakt_seat` stores, for a block it composes: several seats moving at once are the writer's own cases."""

    proposed = {slot: seat_sent(seat, today=today) if isinstance(seat, Mapping) else seat for slot, seat in block.items()}
    rows = database[Collection.SAISON_TEAMS] if saison_teams_collection is None else saison_teams_collection
    bans = ban_list(database)
    governing_saison_id = await ban_list_saison(bans)
    nonce = secrets.token_hex(8)

    async def write(session: AsyncClientSession) -> BlockWritten:
        stored = await pull_one_from_db(
            collection=rows,
            db_filter={"team_id": team_id, "saison_id": saison_id},
            projection=KONTAKT_WRITE_FIELDS,
            session=session,
        )
        confirmations = await write_the_contact_block(
            stored=stored,
            proposed=proposed,
            expected_version=version,
            team_id=team_id,
            saison_id=saison_id,
            saison_teams_collection=rows,
            saisons_collection=database[Collection.SAISONS],
            spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
            outbox_collection=database[Collection.OUTBOX],
            ban_list=bans,
            governing_saison_id=governing_saison_id,
            nonce=nonce,
            today=today,
            germany_now=germany_now,
            session=session,
        )

        return BlockWritten(confirmations=confirmations)

    async with transaction_session(database.client) as session:
        return await session.with_transaction(write)
