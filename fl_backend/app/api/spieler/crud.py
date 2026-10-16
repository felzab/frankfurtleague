from collections.abc import Mapping, Sequence
from typing import Any, NamedTuple

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aktionen.crud import redact_images_in_session
from app.api.saisons.schemas import FLSaisonRules
from app.api.spieler.schemas import FLSpielerRolle
from app.api.spieler.services import (
    SPIELER_ADRESSWECHSEL_FELD,
    build_ghost_spieler,
    build_live_rolle_filter,
    build_live_squad_filter,
    build_selbst_pupil_filter,
    build_spieler_filter,
    find_squad_capacity_refusal,
    find_squad_rolle_refusal,
    spieler_adresswechsel_image_edits,
)
from app.core.collections import Collection
from app.core.crud import (
    aggregate_many_from_db,
    anchor_in_db,
    erase_many_from_db,
    patch_many_in_db,
    patch_one_in_db,
    post_one_to_db,
    pull_one_from_db,
    refuse,
)
from app.core.recording import build_redaction_filter, build_redaction_update
from app.core.sentinels import GHOST_SPIELER_ID
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomObjectId


async def pull_a_person_to_enter(
    *,
    spieler_collection: AsyncCollection,
    spieler_id: CustomObjectId,
    # REQUIRED for `refuse_a_full_squad`'s reason: the anchor below closes the race.
    session: AsyncClientSession,
) -> None:
    """A 404 where nobody stands behind the id, the sentinel included.

    The erasure writes no row this entry writes, so only the anchor on the person puts the two in one
    write set (`docs/backend/spec.md :: I53`).
    """

    await pull_one_from_db(collection=spieler_collection, db_filter=build_spieler_filter(spieler_id), projection=["_id"], session=session)

    await anchor_in_db(
        collection=spieler_collection,
        db_filter={"_id": spieler_id},
        session=session,
    )


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


async def another_pupil_holds(
    *,
    spieler_collection: AsyncCollection,
    # Folded (`app/shared/folding.py :: sign_in_identifier`), the form `spieler.email` stores.
    identifier: str,
    spieler_id: CustomObjectId,
    # The writing transaction's, so the judgement is read where the write lands; `None` for the link's view alone.
    session: AsyncClientSession | None,
) -> bool:
    """Whether a pupil other than this one signs in on the address, which `REQ-SPIELER-006` refuses and the view reads as unconfirmable."""

    # One holder at most, `uniq_spieler_email` being unique, so the one read is compared rather than
    # narrowed by an `_id` term the composed filter would part from the address under `$and`.
    holder = await spieler_collection.find_one(build_selbst_pupil_filter(identifier), projection={"_id": 1}, session=session)

    return holder is not None and holder["_id"] != spieler_id


async def ensure_ghost_spieler(
    *,
    spieler_collection: AsyncCollection,
    # REQUIRED: written outside the erasure's transaction, the sentinel would stand where the erasure
    # it was written for rolled back.
    session: AsyncClientSession,
) -> None:
    """Write the sentinel where none stands, so no reference to an erased pupil is ever repointed at a row nothing holds."""

    if await spieler_collection.find_one({"_id": GHOST_SPIELER_ID}, projection={"_id": 1}, session=session) is None:
        await post_one_to_db(collection=spieler_collection, document=build_ghost_spieler(), session=session)


class PersonErased(NamedTuple):
    spieler: int
    saison_spieler: int
    redacted_aktionen: int


async def erase_person_in_session(
    *,
    spieler_collection: AsyncCollection,
    saison_spieler_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    spieler_id: CustomObjectId,
    # The caller's, so several erasures in one transaction redact under one instant.
    stamp: str,
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one
    # (`docs/backend/spec.md :: I52`).
    session: AsyncClientSession,
) -> PersonErased:
    """Remove the person and their squad rows, then redact the log. Whether they may be erased is the caller's to judge."""

    # Through the by-id filter, before any write: the removals below key on the bare id, so the
    # sentinel handed in by any caller would go, and every reference repointed at it would dangle.
    await pull_one_from_db(collection=spieler_collection, db_filter=build_spieler_filter(spieler_id), projection={"_id": 1}, session=session)

    # Read BEFORE the removal and unbounded: a log row names a squad row by its own `_id`, which
    # nothing can recover once the row is gone, so a capped read would leave the rows it dropped
    # holding this person's values with no way left to find them.
    squad_rows = await aggregate_many_from_db(
        collection=saison_spieler_collection,
        pipeline=[{"$match": {"spieler_id": spieler_id}}, {"$project": {"_id": 1}}],
        session=session,
    )

    # The squad rows first: the public read `$lookup`s outward from the person, so a row left
    # behind is orphaned invisibly rather than surfacing as a fault somebody would notice.
    erased_rows = await erase_many_from_db(collection=saison_spieler_collection, db_filter={"spieler_id": spieler_id}, session=session)
    erased_person = await erase_many_from_db(collection=spieler_collection, db_filter={"_id": spieler_id}, session=session)

    # Last, and it passes over the two rows the removals above just recorded: those carry a
    # filter and a count and no `document_id`, so the erasure stays legible as an action.
    redacted = await patch_many_in_db(
        collection=aktionen_collection,
        db_filter=build_redaction_filter(
            # The squad branch is empty where the person held no row, which matches nothing.
            [(Collection.SPIELER, [spieler_id]), (Collection.SAISON_SPIELER, [row["_id"] for row in squad_rows])]
        ),
        update=build_redaction_update(at=stamp),
        session=session,
    )

    return PersonErased(
        spieler=erased_person.deleted_count, saison_spieler=erased_rows.deleted_count, redacted_aktionen=redacted.modified_count
    )


async def remove_pending_pupil_addresses_in_session(
    *,
    spieler_collection: AsyncCollection,
    # Rows whose pending block names the erased address and whose stored address does not: each is the
    # old address's person's until the change is confirmed, so the block alone goes.
    spieler_ids: Sequence[CustomObjectId],
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one
    # (`docs/backend/spec.md :: I52`).
    session: AsyncClientSession,
) -> int:
    """Remove each pupil row's pending address change, answering how many.

    The row's log images still carry the address: the erasure's pass over other documents' images, run after this, takes it out of them.
    """

    # No write for none: a fan-out matching nothing still files a log row.
    if not spieler_ids:
        return 0

    # A fan-out and by ids alone: its filter, kept as text, names nobody (`docs/backend/spec.md :: I48`).
    removed = await patch_many_in_db(
        collection=spieler_collection,
        db_filter={"_id": {"$in": list(spieler_ids)}},
        update={"$unset": {SPIELER_ADRESSWECHSEL_FELD: ""}},
        session=session,
    )

    return removed.modified_count


async def discard_spieler_adresswechsel_in_session(
    *,
    spieler_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    # The judgement: a pupil it matches not is a miss, `DocumentNotFoundException`, before any write.
    db_filter: Mapping[str, Any],
    stamp: str,
    return_document: bool,
    # REQUIRED, so the address judged in the images is the one this transaction removes.
    session: AsyncClientSession,
) -> Mapping[str, Any]:
    """Remove the pending change, and its address from every log image of that pupil, the rest of each image standing.

    The administrator's discard and the lapse's clock both run this body (`docs/backend/spec.md :: I704`, `:: I693`).
    """

    stored = await pull_one_from_db(
        collection=spieler_collection, db_filter=db_filter, projection={f"{SPIELER_ADRESSWECHSEL_FELD}.email": 1}, session=session
    )
    updated = await patch_one_in_db(
        collection=spieler_collection,
        db_filter=db_filter,
        update={"$unset": {SPIELER_ADRESSWECHSEL_FELD: ""}},
        session=session,
        return_document=return_document,
    )

    # LAST, for the decline's reason: it reaches the pre-image the patch above just filed, which still holds the address.
    discarded = sign_in_identifier(str(stored[SPIELER_ADRESSWECHSEL_FELD]["email"]))
    await redact_images_in_session(
        aktionen_collection=aktionen_collection,
        db_filter=build_redaction_filter([(Collection.SPIELER, [stored["_id"]])]),
        judge=lambda image: spieler_adresswechsel_image_edits(image, discarded),
        stamp=stamp,
        session=session,
    )

    return updated
