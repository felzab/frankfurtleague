from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any, Final, NamedTuple

from pydantic import TypeAdapter
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aufstellungen.crud import erase_pupil_from_aufstellungen_in_session
from app.api.saisons.schemas import FLSaisonRules
from app.api.spielberichte.crud import empty_pupil_entries_in_session
from app.api.spieler.schemas import FLSpielerRolle
from app.api.spieler.services import (
    SquadRoom,
    build_live_rolle_filter,
    build_live_squad_filter,
    build_self_pupil_filter,
    find_full_squad_refusal,
    find_squad_rolle_refusal,
)
from app.core.crud import (
    anchor_in_db,
    delete_many_from_db,
    pull_one_from_db,
    refuse,
)
from app.core.readonly import ReadCollection
from app.shared.schemas.custom import CustomObjectId


async def refuse_a_full_squad(
    *,
    saison_spieler_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    saison_id: str,
    # The season's stored `rules`, which the caller reads in this session beside whatever else of the season it needs:
    # the anchor below, not that read, is what closes the race.
    rules: Mapping[str, Any],
    team_id: CustomObjectId,
    spieler_id: CustomObjectId,
    # Whether the row entering is a nominee's, which the caller reads or derives: a nominee stands outside the cap.
    nominee: bool,
    # REQUIRED: the anchor below is what closes the race, so forgetting the session has to be a
    # TypeError at the call rather than a silent reopening of it.
    session: AsyncClientSession,
) -> None:
    """Refuse `kader_full` when this team's squad for this season is already at the season's cap.

    Shared by every writer that grows a squad: the cap is a property of the DESTINATION squad, not of the verb.
    """

    # A count is a read, which a snapshot re-validates nowhere, so two writers pass one figure
    # unless something puts them in one write set. A nominee's write anchors too: it still contends
    # with a window moved under the verdict that made them one.

    await anchor_in_db(
        collection=saisons_collection,
        db_filter={"_id": saison_id},
        session=session,
    )

    room = await pull_squad_room(
        saison_spieler_collection=saison_spieler_collection,
        saison_id=saison_id,
        team_id=team_id,
        rules=rules,
        excluding_spieler_id=spieler_id,
        session=session,
    )

    refuse(find_full_squad_refusal(room=room, nominee=nominee))


# The season's cap judged by its own field's rule and nothing else, so a read projecting the rules' other fields away
# reads it too: a season missing the key, or holding one the rule refuses, fails here rather than admitting a player
# against a bound nobody chose, or reading every squad as full.
_KADER_SIZE: Final = TypeAdapter[int](Annotated[int, *FLSaisonRules.model_fields["max_kader_size"].metadata])


async def pull_squad_room(
    *,
    saison_spieler_collection: ReadCollection,
    saison_id: str,
    team_id: CustomObjectId,
    # The season's stored `rules`, whole or projected to `max_kader_size`.
    rules: Mapping[str, Any],
    # The writing player, whose own row takes no place from them; `None` where the count is asked for nobody.
    excluding_spieler_id: CustomObjectId | None,
    session: AsyncClientSession | None,
) -> SquadRoom:
    """How many capped rows the squad holds and the season's cap on them: the one read every judgement of the cap takes."""

    size = await saison_spieler_collection.count_documents(
        build_live_squad_filter(saison_id=saison_id, team_id=team_id, excluding_spieler_id=excluding_spieler_id), session=session
    )

    return SquadRoom(size=size, cap=_KADER_SIZE.validate_python(rules.get("max_kader_size")))


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
    """Refuse `kader_rolle_taken` when another live row in this squad already holds `rolle`.

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


async def another_pupil_holds(
    *,
    spieler_collection: ReadCollection,
    # Folded (`app/shared/folding.py :: sign_in_identifier`), the form `spieler.email` stores.
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
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one.
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
