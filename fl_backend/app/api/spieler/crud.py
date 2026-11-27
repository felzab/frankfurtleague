from datetime import datetime
from typing import NamedTuple

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aufstellungen.crud import erase_pupil_from_aufstellungen_in_session
from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import find_saison_past_refusal
from app.api.spielberichte.crud import empty_pupil_entries_in_session
from app.api.spieler.schemas import FLSpielerRolle
from app.api.spieler.services import (
    KaderRoom,
    build_live_kader_filter,
    build_live_rolle_filter,
    build_self_pupil_filter,
    find_full_kader_refusal,
    find_kader_rolle_refusal,
)
from app.core.crud import (
    anchor_in_db,
    delete_many_from_db,
    pull_one_from_db,
    refuse,
    refuse_faults,
)
from app.core.readonly import ReadCollection
from app.shared.schemas.custom import CustomObjectId


async def refuse_a_full_kader(
    *,
    saison_spieler_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    saison_id: str,
    # The season's rules, which the caller reads in this session beside whatever else of the season it needs: the
    # anchor below, not that read, is what closes the race.
    rules: FLSaisonRules,
    team_id: CustomObjectId,
    spieler_id: CustomObjectId,
    # Whether the row entering is a nominee's, which the caller reads or derives: a nominee stands outside the cap.
    nominee: bool,
    # Required: the anchor below is what closes the race, so forgetting the session has to be a
    # TypeError at the call rather than a silent reopening of it.
    session: AsyncClientSession,
) -> None:
    """Refuse `kader_full` when this team's squad for this season is already at the season's cap.

    Shared by every writer that grows a squad: the cap is a property of the destination squad, not of the verb.
    """

    # A count is a read, which a snapshot re-validates nowhere, so two writers pass one figure
    # unless something puts them in one write set. A nominee's write anchors too: it still contends
    # with a window moved under the verdict that made them one.

    await anchor_in_db(
        collection=saisons_collection,
        db_filter={"_id": saison_id},
        session=session,
    )

    room = await pull_kader_room(
        saison_spieler_collection=saison_spieler_collection,
        saison_id=saison_id,
        team_id=team_id,
        rules=rules,
        excluding_spieler_id=spieler_id,
        session=session,
    )

    refuse(find_full_kader_refusal(room=room, nominee=nominee))


async def pull_kader_room(
    *,
    saison_spieler_collection: ReadCollection,
    saison_id: str,
    team_id: CustomObjectId,
    # Validated by the caller, so a season holding rules the model refuses fails there rather than admitting a player
    # against a bound nobody chose, or reading every squad as full.
    rules: FLSaisonRules,
    # The writing player, whose own row takes no place from them; `None` where the count is asked for nobody.
    excluding_spieler_id: CustomObjectId | None,
    session: AsyncClientSession | None,
) -> KaderRoom:
    """How many capped rows the squad holds and the season's cap on them: the one read every judgement of the cap takes."""

    size = await saison_spieler_collection.count_documents(
        build_live_kader_filter(saison_id=saison_id, team_id=team_id, excluding_spieler_id=excluding_spieler_id), session=session
    )

    return KaderRoom(size=size, cap=rules.max_kader_size)


async def refuse_a_closed_kader(
    *,
    saisons_collection: AsyncCollection,
    saison_id: str,
    # Required: the anchor below closes the race.
    session: AsyncClientSession,
) -> None:
    """Refuse `saison_past` when the season has finished: its squad rows are its record, as its other records are.

    For a write moving a squad row, its number, position, level or role, or taking it out or back; a person's own facts
    belong to no season and stay open.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"], session=session)
    # Anchored, so the status belongs to this write set: `activate_saison` writes this document, so a rollover landing
    # under the write conflicts and the retry reads `past`.
    await anchor_in_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)

    refuse(find_saison_past_refusal(saison_status=str(saison_raw["status"])))


async def refuse_a_taken_rolle(
    *,
    saison_spieler_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    saison_id: str,
    team_id: CustomObjectId,
    spieler_id: CustomObjectId,
    rolle: FLSpielerRolle | None,
    # Required: the anchor below closes the race.
    session: AsyncClientSession,
) -> None:
    """Refuse `kader_rolle_taken` when another live row in this squad already holds `rolle`.

    Shared by every squad write: the role belongs to the destination squad, never to the verb.
    """

    # Before the anchor: a row holding no role competes with nobody, so there is no count to protect.
    if rolle is None:
        return

    # Its own anchor rather than the cap's: a caller running this without `refuse_a_full_kader` --
    # a representative's edit, which cannot cross the cap -- would otherwise let two captains through.
    await anchor_in_db(
        collection=saisons_collection,
        db_filter={"_id": saison_id},
        session=session,
    )

    taken = (
        await saison_spieler_collection.find_one(
            build_live_rolle_filter(saison_id=saison_id, team_id=team_id, rolle=rolle, excluding_spieler_id=spieler_id),
            projection={"_id": 1},
            session=session,
        )
    ) is not None

    refuse_faults(find_kader_rolle_refusal(rolle=rolle, taken=taken))


async def another_pupil_holds(
    *,
    spieler_collection: ReadCollection,
    # Folded, the form `spieler.email` stores.
    identifier: str,
    spieler_id: CustomObjectId,
    # The writing transaction's, so the judgement is read where the write lands; `None` for the link's view alone.
    session: AsyncClientSession | None,
) -> bool:
    """Whether a pupil other than this one signs in on the address, which `address_change_taken` refuses and the view reads alike."""

    # One holder at most, `uniq_spieler_email` being unique, so the one read is compared rather than
    # narrowed by an `_id` term the composed filter would part from the address under `$and`.
    holder = await spieler_collection.find_one(build_self_pupil_filter(identifier), projection={"_id": 1}, session=session)

    return holder is not None and holder["_id"] != spieler_id


class PersonErased(NamedTuple):
    spieler: int
    saison_spieler: int


async def erase_person_in_session(
    *,
    spieler_collection: AsyncCollection,
    saison_spieler_collection: AsyncCollection,
    spielberichte_collection: AsyncCollection,
    aufstellungen_collection: AsyncCollection,
    spieler_id: CustomObjectId,
    now: datetime,
    # Required, so a caller forgetting it is a TypeError rather than writes committing one by one.
    session: AsyncClientSession,
) -> PersonErased:
    """Empty their report entries and their played matches' line-up entries, drop their other ones, remove them and their squad rows.

    Whether they may be erased is the caller's to judge.
    """

    # Before any write, so an id no person holds is a 404 rather than an erasure of nothing.
    await pull_one_from_db(collection=spieler_collection, db_filter={"_id": spieler_id}, projection={"_id": 1}, session=session)

    # Before the removal, as the erasure reaches every reference to a person before the person: an
    # entry left naming the id names a row nothing holds.
    await empty_pupil_entries_in_session(spielberichte_collection=spielberichte_collection, spieler_id=spieler_id, session=session)
    await erase_pupil_from_aufstellungen_in_session(
        aufstellungen_collection=aufstellungen_collection, spieler_id=spieler_id, now=now, session=session
    )

    # The squad rows first: the public read starts from them and drops a row whose person its `$lookup` cannot
    # find, so a row left behind is orphaned invisibly rather than surfacing as a fault somebody would notice.
    erased_rows = await delete_many_from_db(collection=saison_spieler_collection, db_filter={"spieler_id": spieler_id}, session=session)
    erased_person = await delete_many_from_db(collection=spieler_collection, db_filter={"_id": spieler_id}, session=session)

    return PersonErased(spieler=erased_person.deleted_count, saison_spieler=erased_rows.deleted_count)
