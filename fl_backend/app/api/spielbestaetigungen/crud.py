from collections.abc import Mapping, Sequence
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aktionen.crud import redact_images_in_session
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungTermin
from app.api.spielbestaetigungen.services import (
    ANSETZUNG_QUELLEN,
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

# What the VIEW reads off the fixture: the Ansetzung's inputs, what the page states of it, and what
# `entscheidung_of` decides on. Never the referee, the rent or the note (`docs/backend/spec.md :: I185`).
ANSICHT_SPIEL_FIELDS: Mapping[str, int] = {
    "_id": 0,
    **dict.fromkeys(ANSETZUNG_QUELLEN.values(), 1),
    **dict.fromkeys(("team1.name", "team2.name", "team1.tore", "team2.tore", "ort.name", "ort.maps_link"), 1),
    **dict.fromkeys(("ergebnis", "elfmeterschiessen", "sonderereignis"), 1),
}


def verein_fields(*, team_id: Any, seat: str, namen: bool) -> dict[str, Any]:
    """`namen` for the answer, which judges a reason against every seat holder of both clubs; the view states the clubs' names."""

    return {
        "_id": 0,
        "team_id": 1,
        "austritt.datum": 1,
        **({f"kontakte.{slot}.{part}": 1 for slot in KONTAKT_ROLLEN for part in ("vorname", "nachname")} if namen else {"name": 1}),
        # The other club's row and every other seat load no address.
        f"kontakte.{seat}.email": {"$cond": [{"$eq": ["$team_id", team_id]}, f"$kontakte.{seat}.email", "$$REMOVE"]},
    }


async def pull_ansetzung_lage(
    *,
    spiele_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    spielbestaetigung_raw: Mapping[str, Any],
    # `None` for the whole fixture, which a proposal is judged as.
    spiel_projection: Mapping[str, Any] | None,
    verein_projection: Mapping[str, Any],
    session: AsyncClientSession | None = None,
) -> AnsetzungLage | None:
    """`None` where the fixture is gone: an undraw or a replace removes it with its rows, so a row read outside a transaction can outlive it."""

    spiel = await spiele_collection.find_one({"_id": spielbestaetigung_raw["spiel_id"]}, spiel_projection, session=session)
    if spiel is None:
        return None

    snapshot = spielbestaetigung_raw["ansetzung"]
    vereine = await saison_teams_collection.find(
        {"saison_id": spielbestaetigung_raw["saison_id"], "team_id": {"$in": [snapshot["team1_id"], snapshot["team2_id"]]}},
        verein_projection,
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
