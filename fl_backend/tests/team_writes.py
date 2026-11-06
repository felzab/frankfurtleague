"""The team editor's two writes as a test drives them: its one save, and the block a seat's write stores."""

import secrets
from collections.abc import Mapping
from datetime import datetime
from typing import Any, NamedTuple

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

from app.api.sperrliste.lookup import ban_list_saison
from app.api.teams.admin_router import KONTAKT_WRITE_FIELDS, patch_team_saison, write_the_contact_block
from app.api.teams.schemas import FLKontaktMint, FLPatchTeamSaisonPayload, FLSaisonTeamKontakte, FLSaisonTeamKontaktePayload
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
    """The row's block as stored after the write, and each person it owed a link."""

    saison_id: str
    team_id: Any
    kontakte: FLSaisonTeamKontakte | None
    confirmations: list[FLKontaktMint]


async def write_the_block(
    database: AsyncDatabase,
    block: Mapping[str, Any] | None,
    *,
    team_id: Any,
    saison_id: str,
    version: int,
    today: str,
    germany_now: datetime,
    saison_teams_collection: Any = None,
) -> BlockWritten:
    """What `put_kontakt_seat` stores, for a block it composes: several seats moving at once are the writer's own cases."""

    proposed = None if block is None else FLSaisonTeamKontaktePayload.model_validate(block).model_dump(mode="json")
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
        updated, confirmations = await write_the_contact_block(
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

        written = updated["kontakte"]

        return BlockWritten(
            saison_id=saison_id,
            team_id=team_id,
            kontakte=None if written is None else FLSaisonTeamKontakte.model_validate(written),
            confirmations=confirmations,
        )

    async with transaction_session(database.client) as session:
        return await session.with_transaction(write)
