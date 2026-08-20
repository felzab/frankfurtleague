from typing import Any, Mapping, Sequence

from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection

from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import (
    FLBracketFault,
    FLSpiel,
    FLSpielAdvancement,
    FLSpielJoined,
    FLSpielJoinedListAdapter,
    FLSpielListAdapter,
    FLSpielQuelleGruppe,
    FLSpielReleasedSide,
    FLSpielTeamField,
)
from app.api.spiele.services import (
    BookedReferee,
    BookedVenue,
    BracketResolution,
    SaisonMembership,
    SlotAdvancement,
    SpieltagRelease,
    build_spiele_pipeline,
    find_departed_occupants,
    find_double_entries,
    resolve_bracket,
)
from app.api.teams.schemas import FLGruppenNames, FLTeamListAdapter, FLTeamsFilterParams
from app.api.teams.services import ZERO_STATISTIK, DecidedStanding, build_decided_standings, build_statistik_by_team, build_team_pipeline
from app.core.crud import aggregate_many_from_db, patch_one_in_db, pull_many_from_db
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomObjectId


async def _resolve_one_saison(
    teams_collection: AsyncIOMotorCollection,
    saison_id: str,
    rules: FLSaisonRules,
    spiele: Sequence[FLSpiel],
    session: AsyncIOMotorClientSession | None = None,
) -> BracketResolution:
    """One season's bracket resolved against its own standings.

    Shared by the write path and the fault derivation, so no second implementation can answer
    differently about who finished second.
    """

    referenced_gruppen: set[FLGruppenNames] = {
        quelle.gruppe for spiel in spiele for quelle in (spiel.team1_quelle, spiel.team2_quelle) if isinstance(quelle, FLSpielQuelleGruppe)
    }

    standings: Mapping[FLGruppenNames, DecidedStanding] = {}
    if referenced_gruppen:
        # `GET /teams`' own pipeline, so the bracket ranks the clubs the site's table ranks, and
        # `include_inactive` stays default: a hidden club must not hold a placing the bracket honours.
        # `rules=None` asks it for the ROWS alone.
        teams_raw = await aggregate_many_from_db(
            collection=teams_collection,
            pipeline=build_team_pipeline(filters=FLTeamsFilterParams(saison_id=saison_id), rules=None),
            session=session,
        )

        # The group phase alone: a head-to-head drawn from playoff matches would break a tie on
        # results those points never saw. It is also the scope the figures below are derived at.
        gruppenphase = [spiel for spiel in spiele if spiel.saison_phase == "gruppenphase"]

        # From the fixtures ARGUED, never re-read: the preview hands in a season this collection
        # does not hold yet, so a table read back from it would rank the save's fixtures while the
        # walk ranks the preview's (`docs/backend/spec.md :: I29`).
        by_team = build_statistik_by_team(gruppenphase, rules)

        standings = build_decided_standings(
            teams=FLTeamListAdapter.validate_python([{**team, "statistik": by_team.get(team["_id"], ZERO_STATISTIK)} for team in teams_raw]),
            spiele=gruppenphase,
            rules=rules,
            gruppen=referenced_gruppen,
        )

    return resolve_bracket(spiele, standings)


async def find_bracket_faults(
    spiele_collection: AsyncIOMotorCollection,
    teams_collection: AsyncIOMotorCollection,
    saisons_collection: AsyncIOMotorCollection,
) -> tuple[list[FLBracketFault], list[FLSpielJoined]]:
    """Every derived fault in every season, and the fixtures they name.

    The season read asks one over the cap, so an archive too large for one pass is DETECTED
    rather than served as one whose unread seasons hold no faults (`docs/backend/spec.md :: I45`).
    """

    spiele = FLSpielJoinedListAdapter.validate_python(
        await aggregate_many_from_db(collection=spiele_collection, pipeline=build_spiele_pipeline(db_filter={}))
    )
    saisons_raw = await pull_many_from_db(collection=saisons_collection, db_filter={}, projection={"rules": 1}, limit=LIST_LIMIT_DEFAULT + 1)
    if len(saisons_raw) > LIST_LIMIT_DEFAULT:
        raise ValueError(f"the archive holds more than {LIST_LIMIT_DEFAULT} seasons, which is more than one read can report on")

    by_saison: dict[str, list[FLSpiel]] = {}
    for spiel in spiele:
        by_saison.setdefault(spiel.saison_id, []).append(spiel)

    faults: list[FLBracketFault] = []
    faulted_ids: set[object] = set()

    # Sorted, so the report is ordered by season rather than by the order the reads returned.
    for saison_raw in sorted(saisons_raw, key=lambda saison: str(saison["_id"])):
        saison_id = str(saison_raw["_id"])
        saison_spiele = by_saison.get(saison_id)
        if not saison_spiele:
            continue

        resolution = await _resolve_one_saison(
            teams_collection=teams_collection,
            saison_id=saison_id,
            rules=FLSaisonRules.model_validate(saison_raw["rules"]),
            spiele=saison_spiele,
        )
        faults.extend(resolution.bracket_faults)
        faulted_ids.update(fault.spiel_id for fault in resolution.bracket_faults)

    # From the JOINED fixtures, not the resolution: this compares a fixture's date against a junction
    # record, so it sits beside the walk and covers group fixtures too.
    occupant_faults = find_departed_occupants(spiele)
    faults.extend(occupant_faults)
    faulted_ids.update(fault.spiel_id for fault in occupant_faults)

    # Beside the walk for the same reason, and over the whole archive rather than per season: what
    # groups a clash is the `spieltag_id`, which one season alone holds.
    double_entries = find_double_entries(spiele)
    faults.extend(double_entries)
    faulted_ids.update(fault.spiel_id for fault in double_entries)

    faulted_spiele = [spiel for spiel in spiele if spiel.id in faulted_ids]

    return faults, faulted_spiele


async def pull_saison_membership(
    saison_teams_collection: AsyncIOMotorCollection,
    saison_id: str,
    session: AsyncIOMotorClientSession | None = None,
) -> dict[CustomObjectId, SaisonMembership]:
    """Which teams hold a row for this season, under which name, and from which DAY each is out.

    Not `build_team_pipeline`, which filters `inactive_since` away -- a club that left the LEAGUE
    still holds the row a refusal about this season must see.
    """

    rows = await pull_many_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_id},
        projection={"team_id": 1, "austritt": 1, "name": 1, "shorthand": 1},
        session=session,
    )

    return {
        row["team_id"]: SaisonMembership(
            name=row["name"],
            shorthand=row["shorthand"],
            # The `.get` is for the null record: a present `austritt` always carries a `datum`.
            departed_from=(row["austritt"] or {}).get("datum"),
        )
        for row in rows
    }


async def pull_booked_venue(
    spielorte_collection: AsyncIOMotorCollection,
    spielort_id: CustomObjectId | None,
    session: AsyncIOMotorClientSession | None = None,
) -> BookedVenue | None:
    """The venue this payload's reference names, or `None` for no reference and for one naming no row.

    `find_one` rather than `pull_one_from_db`'s 404: an id the admin picked wrongly is a refusal
    about the payload, not a missing fixture.
    """

    if spielort_id is None:
        return None

    row = await spielorte_collection.find_one({"_id": spielort_id}, {"name": 1, "maps_link": 1, "inactive_since": 1}, session=session)
    if row is None:
        return None

    return BookedVenue(name=row["name"], maps_link=row["maps_link"], inactive_since=row["inactive_since"])


async def pull_booked_referee(
    schiedsrichter_collection: AsyncIOMotorCollection,
    schiedsrichter_id: CustomObjectId | None,
    session: AsyncIOMotorClientSession | None = None,
) -> BookedReferee | None:
    """The referee this payload's reference names, for the reason `pull_booked_venue` exists."""

    if schiedsrichter_id is None:
        return None

    row = await schiedsrichter_collection.find_one({"_id": schiedsrichter_id}, {"name": 1, "inactive_since": 1}, session=session)
    if row is None:
        return None

    return BookedReferee(name=row["name"], inactive_since=row["inactive_since"])


async def preview_bracket_after_patch(
    teams_collection: AsyncIOMotorCollection,
    saison_id: str,
    rules: FLSaisonRules,
    season: Sequence[FLSpiel],
    patched: FLSpiel,
    releases: Sequence[SpieltagRelease],
) -> tuple[list[FLSpielAdvancement], list[FLSpielReleasedSide], list[FLBracketFault]]:
    """What saving this payload would move and destroy, writing nothing.

    The same `_resolve_one_saison` the save uses, over a season rebuilt in memory with the releases
    substituted FIRST: a released slot can be refilled by the resolution.
    """

    substituted = {patched.id: patched}
    for release in releases:
        current = substituted.get(release.spiel_id) or next(spiel for spiel in season if spiel.id == release.spiel_id)
        substituted[release.spiel_id] = apply_release_to_spiel(current, release)

    resolution = await _resolve_one_saison(
        teams_collection=teams_collection,
        saison_id=saison_id,
        rules=rules,
        spiele=[substituted.get(spiel.id, spiel) for spiel in season],
    )

    return (
        [report_advancement(advancement) for advancement in resolution.advancements],
        [report_release(release) for release in releases],
        resolution.bracket_faults,
    )


def _stored_side(side: FLSpielTeamField | None) -> Mapping[str, Any] | None:
    """One resolved side as the DOCUMENT stores it; `include` is `FLSpielTeamField`'s field set, so no join can denormalise into it."""

    if side is None:
        return None

    # `keep_oid` keeps `team_id` an ObjectId: as a string the `spiele` validator rejects the write,
    # and the transaction takes the admin's own edit down with it.
    return side.model_dump(context={"keep_oid": True}, include=set(FLSpielTeamField.model_fields))


async def advance_bracket_winners(
    spiele_collection: AsyncIOMotorCollection,
    teams_collection: AsyncIOMotorCollection,
    saison_id: str,
    rules: FLSaisonRules,
    session: AsyncIOMotorClientSession,
) -> tuple[list[FLSpielAdvancement], list[FLBracketFault]]:
    """Resolve one season's bracket and write back every fixture whose slots disagree.

    The WHOLE season, not only what the changed match feeds, so the result does not depend on which
    edit triggered it and a second run writes nothing.
    """

    # One over the cap, so a truncated season is DETECTED rather than resolved: a dropped fixture
    # reads as a dangling source, and the bracket written back would be resolved from a season
    # with a hole in it.
    spiele_raw = await pull_many_from_db(
        collection=spiele_collection,
        db_filter={"saison_id": saison_id},
        limit=LIST_LIMIT_DEFAULT + 1,
        session=session,
    )
    if len(spiele_raw) > LIST_LIMIT_DEFAULT:
        raise ValueError(f"season {saison_id} holds more than {LIST_LIMIT_DEFAULT} fixtures, which is more than one read can resolve")

    spiele = FLSpielListAdapter.validate_python(spiele_raw)

    resolution = await _resolve_one_saison(
        teams_collection=teams_collection,
        saison_id=saison_id,
        rules=rules,
        spiele=spiele,
        session=session,
    )

    for advancement in resolution.advancements:
        # The result goes with the occupant (`docs/backend/spec.md :: I25b`): what was scored here
        # was scored by a team no longer in the fixture.
        await patch_one_in_db(
            collection=spiele_collection,
            db_filter={"_id": advancement.spiel_id},
            update={
                "$set": {
                    "team1": _stored_side(advancement.team1),
                    "team2": _stored_side(advancement.team2),
                    "ergebnis": None,
                    "elfmeterschiessen": None,
                    # Conditional, so only a no-show goes: `ausgefallen`, `annulliert` and `abgebrochen`
                    # name no side, so replacing an occupant leaves each of them true.
                    **({"sonderereignis": None} if advancement.voided_sonderereignis is not None else {}),
                }
            },
            session=session,
        )

    return [report_advancement(advancement) for advancement in resolution.advancements], resolution.bracket_faults


def report_advancement(advancement: SlotAdvancement) -> FLSpielAdvancement:
    """One advancement as the response reports it -- the one mapping to the wire shape, so save and preview report alike."""

    return FLSpielAdvancement(
        spiel_nr=advancement.spiel_nr,
        voided_ergebnis=advancement.voided_ergebnis,
        voided_elfmeterschiessen=advancement.voided_elfmeterschiessen,
        voided_sonderereignis=advancement.voided_sonderereignis,
    )


def report_release(release: SpieltagRelease) -> FLSpielReleasedSide:
    """One released side as the response reports it, for the same reason `report_advancement` exists."""

    return FLSpielReleasedSide(
        spiel_nr=release.spiel_nr,
        side=release.side,
        team_name=release.team_name,
        voided_ergebnis=release.voided_ergebnis,
        voided_elfmeterschiessen=release.voided_elfmeterschiessen,
        voided_sonderereignis=release.voided_sonderereignis,
    )


def apply_release_to_spiel(spiel: FLSpiel, release: SpieltagRelease) -> FLSpiel:
    """One fixture with the released side emptied.

    The PREVIEW's model; the write spells the same rule as a `$set`, held to it by
    `tests/api/test_spiele_write_execution.py`. The side left behind loses its goals too, scored
    against the team being removed.
    """

    other = "team2" if release.side == "team1" else "team1"
    other_side: FLSpielTeamField | None = getattr(spiel, other)

    return spiel.model_copy(
        update={
            release.side: None,
            other: other_side.model_copy(update={"tore": None}) if other_side is not None else None,
            "ergebnis": None,
            "elfmeterschiessen": None,
            # Conditional for the reason `advance_bracket_winners` states, and read off the release
            # rather than off `spiel`, so the model and the `$set` cannot key on different facts.
            **({"sonderereignis": None} if release.voided_sonderereignis is not None else {}),
        }
    )


async def release_spieltag_sides(
    spiele_collection: AsyncIOMotorCollection,
    releases: Sequence[SpieltagRelease],
    session: AsyncIOMotorClientSession,
) -> list[FLSpielReleasedSide]:
    """Empty each side another fixture gives up so a team can play this Spieltag.

    INSIDE the caller's transaction and BEFORE `advance_bracket_winners`, so the resolution sees the
    released state and can refill the slot.
    """

    for release in releases:
        await patch_one_in_db(
            collection=spiele_collection,
            db_filter={"_id": release.spiel_id},
            update={
                "$set": {
                    release.side: None,
                    # Named, not re-read: this transaction has already read the season, and reading
                    # a fixture again to strip one number would be a second answer.
                    **({f"{'team2' if release.side == 'team1' else 'team1'}.tore": None} if release.other_side_present else {}),
                    "ergebnis": None,
                    "elfmeterschiessen": None,
                    **({"sonderereignis": None} if release.voided_sonderereignis is not None else {}),
                }
            },
            session=session,
        )

    return [report_release(release) for release in releases]
