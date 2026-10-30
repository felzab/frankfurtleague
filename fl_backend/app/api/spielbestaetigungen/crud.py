from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aktionen.crud import redact_images_in_session
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungTermin
from app.api.spielbestaetigungen.services import (
    ADMIN_FIELDS,
    ANSETZUNG_QUELLEN,
    AnsetzungLage,
    SeatVoid,
    build_holding_filter,
    build_referee_images_filter,
    build_referee_rows_filter,
    build_season_entries_filter,
    build_season_halter_filter,
    build_season_images_filter,
    build_season_reasons_filter,
    build_seat_entry_images_filter,
    referee_image_edits,
    season_end_image_edits,
    seat_entry_image_edits,
)
from app.api.spiele.schemas import FLSpielOrtFieldPublic
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, anchor_in_db, loeschen_many_from_db, patch_many_in_db, pull_many_from_db
from app.core.recording import build_redaction_filter, build_redaction_update
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.literals import KONTAKT_ROLLEN

# --- The LINK's view and answer.

# What the VIEW reads off the fixture: the Ansetzung's inputs, what the page states of it, and what
# `grund_to_close` decides on. Never the referee, the rent or the note.
ANSICHT_SPIEL_FIELDS: Mapping[str, int] = {
    "_id": 0,
    **dict.fromkeys(ANSETZUNG_QUELLEN.values(), 1),
    **dict.fromkeys(("team1.name", "team2.name", "team1.tore", "team2.tore", "ort.name", "ort.maps_link"), 1),
    **dict.fromkeys(("ergebnis", "sonderereignis"), 1),
}


def verein_fields(*, team_id: Any, seat: str) -> dict[str, Any]:
    """The clubs' season rows as a link reads them: the exit the close judges, the name the view states, no seat holder's name."""

    return {
        "_id": 0,
        "team_id": 1,
        "austritt.datum": 1,
        "name": 1,
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


# --- The ADMINISTRATOR's read.


async def pull_admin_rows(
    *, spielbestaetigungen_collection: AsyncCollection, db_filter: Mapping[str, Any], limit: int
) -> tuple[list[Mapping[str, Any]], bool]:
    """Every row still holding its question, whole, and the newest `limit` of the rest; and whether none was left out.

    A cut across all rows would drop the oldest open ones, the overdue, first.
    """

    holding = await spielbestaetigungen_collection.find({**db_filter, **build_holding_filter()}, ADMIN_FIELDS).to_list(length=None)
    # Read after the holding rows, so a row closing between the two reads arrives twice rather than not at all, and
    # its closed image wins below.
    rest = await pull_many_from_db(
        collection=spielbestaetigungen_collection,
        db_filter={**db_filter, "$nor": [build_holding_filter()]},
        # One row over what is served, and the extra never is: it answers whether the list is whole without a count.
        limit=limit + 1,
        # Rows carry no creation stamp; an ObjectId's leading bytes are its insert time.
        sort_by=[("_id", -1)],
        projection=ADMIN_FIELDS,
    )
    rows = {row["_id"]: row for row in [*holding, *rest[:limit]]}

    return sorted(rows.values(), key=lambda row: row["_id"], reverse=True), len(rest) <= limit


# --- A REFEREE'S OWN ROWS.

# No seat's hashes and no deadline: a referee answers signed in, until the fixture's day.
EIGENE_ZEILE_FIELDS: Mapping[str, int] = {
    "saison_id": 1,
    "spiel_id": 1,
    "partei": 1,
    "ansetzung": 1,
    "antwort.art": 1,
    "antwort.von.art": 1,
    "antwort.begruendung": 1,
    "geschlossen": 1,
}

# The view's fields and the booked referee, whom `grund_to_close` compares a referee's row against.
EIGENE_SPIEL_FIELDS: Mapping[str, int] = {**ANSICHT_SPIEL_FIELDS, "_id": 1, "schiedsrichter.schiedsrichter_id": 1}

EIGENE_VEREIN_FIELDS: Mapping[str, int] = {"_id": 0, "saison_id": 1, "team_id": 1, "name": 1, "austritt.datum": 1}


async def pull_eigene_lagen(
    *,
    spiele_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    spielbestaetigungen_raw: Sequence[Mapping[str, Any]],
    session: AsyncClientSession,
) -> dict[Any, AnsetzungLage]:
    """Each row's fixture and clubs' season rows, two reads for the whole list, keyed by the row's id."""

    if not spielbestaetigungen_raw:
        return {}

    spiele = await spiele_collection.find(
        {"_id": {"$in": list({row["spiel_id"] for row in spielbestaetigungen_raw})}}, EIGENE_SPIEL_FIELDS, session=session
    ).to_list(length=None)
    vereine = await saison_teams_collection.find(
        {
            "saison_id": {"$in": list({row["saison_id"] for row in spielbestaetigungen_raw})},
            "team_id": {"$in": list({row["ansetzung"][key] for row in spielbestaetigungen_raw for key in ("team1_id", "team2_id")})},
        },
        EIGENE_VEREIN_FIELDS,
        session=session,
    ).to_list(length=None)
    by_id = {spiel["_id"]: spiel for spiel in spiele}

    return {
        row["_id"]: AnsetzungLage(
            # An undraw removes a fixture with its rows in one transaction, and this read shares their snapshot.
            spiel=by_id[row["spiel_id"]],
            vereine=[
                verein
                for verein in vereine
                if verein["saison_id"] == row["saison_id"] and verein["team_id"] in (row["ansetzung"]["team1_id"], row["ansetzung"]["team2_id"])
            ],
        )
        for row in spielbestaetigungen_raw
    }


async def pull_spielorte_public(
    *, spielorte_collection: AsyncCollection, spielort_ids: Iterable[Any], session: AsyncClientSession
) -> dict[Any, FLSpielOrtFieldPublic]:
    """The grounds a moved row's Ansetzung names, as the link's view serves one; a ground no row holds is absent."""

    wanted = list({spielort_id for spielort_id in spielort_ids if spielort_id is not None})
    if not wanted:
        return {}

    orte = await spielorte_collection.find({"_id": {"$in": wanted}}, {"name": 1, "maps_link": 1}, session=session).to_list(length=None)

    return {ort["_id"]: FLSpielOrtFieldPublic(spielort_id=ort["_id"], name=ort["name"], maps_link=ort["maps_link"]) for ort in orte}


# --- A LEAVING CONTACT'S seats in the log: an erasure's, a Widerspruch's, and the season's end.


async def redact_seat_entries_in_images(
    *,
    aktionen_collection: AsyncCollection,
    voids: Sequence[SeatVoid | None],
    stamp: str,
    # REQUIRED for `redact_images_in_session`'s reason.
    session: AsyncClientSession,
) -> int:
    """These seats' link entries out of every log image of their teams' rows, as the void took them off the rows.

    A seat handed on keeps its images: only a person's leaving owes them (`build_clearing_update`'s rule for the season row).
    """

    voided = [void for void in voids if void is not None]
    if not voided:
        return 0

    return await redact_images_in_session(
        aktionen_collection=aktionen_collection,
        db_filter=build_seat_entry_images_filter(voided),
        judge=lambda image: seat_entry_image_edits(image, voided),
        stamp=stamp,
        session=session,
    )


async def strip_the_seasons_confirmations(
    *,
    spielbestaetigungen_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    saison_id: str,
    stamp: str,
    # REQUIRED: the season's end judged in the same snapshot, so an activation since the caller's read keeps the rows.
    session: AsyncClientSession,
) -> int:
    """At the season's end, every link entry, reason and holder digest left on the season's rows and their images.

    A replaced club's rows, a referee's and an administrator's reason among them; each answer's way and role stay as the
    record.
    """

    # Every seat, whoever held it: what a block's void left standing, a hand edit's or a restore's, goes too.
    await patch_many_in_db(
        collection=spielbestaetigungen_collection,
        db_filter=build_season_entries_filter(saison_id),
        update={"$set": {f"kontakte.{seat}": None for seat in KONTAKT_ROLLEN}},
        session=session,
    )
    await patch_many_in_db(
        collection=spielbestaetigungen_collection,
        db_filter=build_season_reasons_filter(saison_id),
        update={"$set": {"antwort.begruendung": None}},
        session=session,
    )
    await patch_many_in_db(
        collection=spielbestaetigungen_collection,
        db_filter=build_season_halter_filter(saison_id),
        update={"$set": {"antwort.von.halter": None}},
        session=session,
    )

    return await redact_images_in_session(
        aktionen_collection=aktionen_collection,
        db_filter=build_season_images_filter(saison_id),
        judge=lambda image: season_end_image_edits(image, saison_id),
        stamp=stamp,
        session=session,
    )


# --- The REFEREE'S ERASURE, the registry's member for their confirmation rows.


async def loeschen_referee_confirmations_in_session(
    *,
    spielbestaetigungen_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    schiedsrichter_ids: Sequence[CustomObjectId],
    # The caller's, so every redaction of one erasure carries one instant.
    stamp: str,
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one.
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

    geloescht = 0
    if rows:
        # Removed, never repointed as the fixtures are: the sweep mints the ghost no row.
        # Ids and their seasons alone, never the referee's id: the log keeps an erasure's filter as text.
        removed = await loeschen_many_from_db(
            collection=spielbestaetigungen_collection,
            db_filter={"saison_id": {"$in": sorted({row["saison_id"] for row in rows})}, "_id": {"$in": [row["_id"] for row in rows]}},
            session=session,
        )
        geloescht = removed.deleted_count
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

    return geloescht


# --- The PASS's mint.


async def anchor_the_seats_minted(
    *,
    saison_teams_collection: AsyncCollection,
    saison_team_ids: Sequence[Any],
    # REQUIRED: committed on its own, the anchor conflicts with no seat write.
    session: AsyncClientSession,
) -> None:
    """Write the season rows a mint read its links' holders off.

    A seat write voids the links its own snapshot holds, never one a mint writes beside it.
    """

    await anchor_in_db(collection=saison_teams_collection, db_filter={"_id": {"$in": list(saison_team_ids)}}, session=session)


async def anchor_the_mailboxes_told(
    *,
    saison_teams_collection: AsyncCollection,
    saison_team_ids: Sequence[Any],
    # REQUIRED: committed on its own, the anchor conflicts with no seat write.
    session: AsyncClientSession,
) -> None:
    """Write the season rows the notice step read its notices' mailboxes off.

    An erasure or a Widerspruch empties the seat on that row and writes nothing the notice step writes.
    """

    await anchor_in_db(collection=saison_teams_collection, db_filter={"_id": {"$in": list(saison_team_ids)}}, session=session)


async def anchor_the_referees_told(
    *,
    schiedsrichter_collection: AsyncCollection,
    schiedsrichter_ids: Sequence[Any],
    # REQUIRED: committed on its own, the anchor conflicts with no erasure.
    session: AsyncClientSession,
) -> None:
    """Write the referees a step tells: the mint's and the reminder's, the notice step's.

    A referee's erasure deletes only the rows its snapshot holds, never the mint's insert beside it, so this write conflicts.
    """

    await anchor_in_db(collection=schiedsrichter_collection, db_filter={"_id": {"$in": list(schiedsrichter_ids)}}, session=session)
