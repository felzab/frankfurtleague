from collections.abc import Mapping, Sequence
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aktionen.crud import redact_images_in_session
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungTermin
from app.api.spielbestaetigungen.services import (
    AnsetzungLage,
    build_referee_images_filter,
    build_referee_rows_filter,
    referee_image_edits,
)
from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, erase_many_from_db, patch_many_in_db
from app.core.recording import build_redaction_filter, build_redaction_update
from app.shared.schemas.custom import CustomObjectId

# --- The LINK's view and answer.

# What a link is judged on from the clubs: the season's name, the exit, the seat's address the ban
# list is asked about, and the names a reason may not hold.
VEREIN_FIELDS: Mapping[str, int] = {
    "team_id": 1,
    "name": 1,
    "austritt": 1,
    **{f"kontakte.{seat}.{part}": 1 for seat in KONTAKT_ROLLEN for part in ("email", "vorname", "nachname")},
}


async def pull_ansetzung_lage(
    *,
    spiele_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    spielbestaetigung_raw: Mapping[str, Any],
    session: AsyncClientSession | None = None,
) -> AnsetzungLage:
    """The fixture whole, and the season rows of the two clubs the row's snapshot names."""

    # `find_one` rather than `pull_one_from_db`'s 404: removing a fixture removes its rows with it in one
    # transaction, so a miss is a broken invariant rather than an answer.
    spiel = await spiele_collection.find_one({"_id": spielbestaetigung_raw["spiel_id"]}, session=session)
    assert spiel is not None, f"spielbestaetigung {spielbestaetigung_raw['_id']} outlived its fixture"

    snapshot = spielbestaetigung_raw["ansetzung"]
    vereine = await saison_teams_collection.find(
        {"saison_id": spielbestaetigung_raw["saison_id"], "team_id": {"$in": [snapshot["team1_id"], snapshot["team2_id"]]}},
        VEREIN_FIELDS,
        session=session,
    ).to_list(length=None)

    return AnsetzungLage(spiel=spiel, vereine=vereine)


async def pull_vorschlag_offen(
    *, spielbestaetigungen_collection: AsyncCollection, spielbestaetigung_raw: Mapping[str, Any]
) -> FLSpielbestaetigungTermin | None:
    """The other club's proposal about this same Ansetzung while its decline stands open, its date and hour alone.

    Open, because a discarded proposal is in front of nobody.
    """

    other = await spielbestaetigungen_collection.find_one(
        {
            "saison_id": spielbestaetigung_raw["saison_id"],
            "spiel_id": spielbestaetigung_raw["spiel_id"],
            "partei.art": "team",
            "partei.team_id": {"$ne": spielbestaetigung_raw["partei"]["team_id"]},
            "ansetzung.stand": spielbestaetigung_raw["ansetzung"]["stand"],
            "antwort.art": "abgelehnt",
            "geschlossen": None,
        },
        projection={"antwort.vorschlag": 1},
    )
    vorschlag = ((other or {}).get("antwort") or {}).get("vorschlag")

    return FLSpielbestaetigungTermin.model_validate(vorschlag) if isinstance(vorschlag, Mapping) else None


# --- The REFEREE'S ERASURE, the registry's member for their confirmation rows.


async def erase_referee_confirmations_in_session(
    *,
    spielbestaetigungen_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    schiedsrichter_ids: Sequence[CustomObjectId],
    # The caller's, so every redaction of one erasure carries one instant.
    stamp: str,
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one
    # (`docs/backend/spec.md :: I52`).
    session: AsyncClientSession,
) -> int:
    """Remove every confirmation row these referees are the party of with its log images, and repoint any other image of theirs at the ghost.

    Run ahead of the referee's own step, which removes the document the rows name.
    """

    # No command for none: a person holding no referee row costs this step nothing.
    if not schiedsrichter_ids:
        return 0

    rows = await aggregate_many_from_db(
        collection=spielbestaetigungen_collection,
        pipeline=[{"$match": build_referee_rows_filter(schiedsrichter_ids)}, {"$project": {"saison_id": 1}}],
        session=session,
    )

    erased = 0
    if rows:
        # Removed, never repointed as the fixtures are: the sweep mints the ghost no row (`docs/backend/spec.md :: I761`).
        # Ids and their seasons alone, never the referee's id: the log keeps an erasure's filter as text (`:: I48`).
        removed = await erase_many_from_db(
            collection=spielbestaetigungen_collection,
            db_filter={"saison_id": {"$in": sorted({row["saison_id"] for row in rows})}, "_id": {"$in": [row["_id"] for row in rows]}},
            session=session,
        )
        erased = removed.deleted_count
        # Whole, as every record an erasure removes: the row is theirs, so its earlier states are too.
        await patch_many_in_db(
            collection=aktionen_collection,
            db_filter=build_redaction_filter([(Collection.SPIELBESTAETIGUNGEN, [row["_id"] for row in rows])]),
            update=build_redaction_update(at=stamp),
            session=session,
        )

    # Then every other image naming them, which only their part of leaves: an undraw's array holds rows long gone
    # beside other parties', the referee's id and reason among them.
    await redact_images_in_session(
        aktionen_collection=aktionen_collection,
        db_filter=build_referee_images_filter(schiedsrichter_ids),
        judge=lambda image: referee_image_edits(image, schiedsrichter_ids),
        stamp=stamp,
        session=session,
    )

    return erased
