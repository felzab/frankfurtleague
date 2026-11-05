from collections.abc import Mapping, Sequence, Set
from dataclasses import dataclass
from datetime import datetime
from typing import Any, NamedTuple

from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import find_saison_past_refusal
from app.api.spielberichte.crud import stamp_the_adoption
from app.api.spielberichte.services import seiten_of
from app.api.spiele.schemas import (
    SPIEL_PATCH_WRITTEN_FIELDS,
    FLBracketFault,
    FLPatchSpielDataPayload,
    FLPatchSpielDataResponse,
    FLSpiel,
    FLSpielAdvancement,
    FLSpielCommon,
    FLSpielJoinedAdmin,
    FLSpielJoinedInternalListAdapter,
    FLSpielListAdapter,
    FLSpielQuelleGruppe,
    FLSpielReleasedSide,
    FLSpielSlotHolder,
    FLSpielSlotHolderListAdapter,
    FLSpielTeamField,
)
from app.api.spiele.services import (
    BookedReferee,
    BookedReferences,
    BookedSlot,
    BookedVenue,
    BracketResolution,
    ResolvedReferences,
    SaisonMembership,
    SlotAdvancement,
    SlotClaim,
    SpieltagRelease,
    apply_payload_to_spiel,
    build_slot_holder_filter,
    build_spiele_pipeline,
    find_advancement_occupancy_refusal,
    find_booking_refusal,
    find_claims_made,
    find_clash_refusal,
    find_departed_occupants,
    find_double_bookings,
    find_double_entries,
    find_eligibility_refusal,
    find_fixture_date_refusal,
    find_gruppen_not_run,
    find_referee_stand_refusal,
    find_references_to_anchor,
    find_result_removal_refusal,
    find_retired_bookings,
    find_slot_claims,
    find_state_refusal,
    find_wiring_refusal,
    judge_spieltag_occupancy,
    reopens,
    resolve_bracket,
    slots_booked_against,
    stored_in_slice,
)
from app.api.teams.schemas import FLTeamListAdapter, FLTeamsFilterParams
from app.api.teams.services import (
    ZERO_STATISTIK,
    DecidedStanding,
    build_decided_standings,
    build_statistik_by_team,
    build_team_pipeline,
    offered_gruppen,
)
from app.core.crud import VERSION_FIELD, aggregate_many_from_db, anchor_in_db, patch_one_in_db, pull_many_from_db, pull_one_from_db, refuse
from app.core.readonly import ReadCollection
from app.shared.einwilligung import is_confirmed
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.literals import FLGruppenNames, FLSpielSeite


async def _resolve_one_saison(
    teams_collection: ReadCollection,
    saison_id: str,
    rules: FLSaisonRules,
    spiele: Sequence[FLSpielCommon],
    session: AsyncClientSession | None = None,
) -> BracketResolution:
    """One season's bracket resolved against its own standings.

    Shared by the write path and the fault derivation, so no second implementation can answer
    differently about who finished second.
    """

    referenced_gruppen: set[FLGruppenNames] = {
        quelle.gruppe for spiel in spiele for quelle in (spiel.team1_quelle, spiel.team2_quelle) if isinstance(quelle, FLSpielQuelleGruppe)
    }

    # The groups the season RUNS alone: a standing built for any other would have the walk report a
    # reference to it as a table too short, where `find_gruppen_not_run` names the group.
    gruppen_to_decide = referenced_gruppen & set(offered_gruppen(rules.number_of_gruppen))

    standings: Mapping[FLGruppenNames, DecidedStanding] = {}
    if gruppen_to_decide:
        # The Tabelle's own pipeline, so the bracket ranks the clubs the site's table ranks, and
        # `include_inactive` stays default: a club that table withholds must hold no placing the bracket
        # honours. `rules=None` asks it for the ROWS alone.

        # No `GERMAN_COLLATION`, unlike the reads that serve that pipeline to a page: what comes back
        # here is grouped and ranked by points, so its order reaches nobody and would only cost the
        # junction join its index.
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
        # walk ranks the preview's.
        by_team = build_statistik_by_team(gruppenphase, rules)

        standings = build_decided_standings(
            teams=FLTeamListAdapter.validate_python([{**team, "statistik": by_team.get(team["_id"], ZERO_STATISTIK)} for team in teams_raw]),
            spiele=gruppenphase,
            rules=rules,
            gruppen=gruppen_to_decide,
        )

    resolution = resolve_bracket(spiele, standings)

    return BracketResolution(
        advancements=resolution.advancements,
        bracket_faults=[*resolution.bracket_faults, *find_gruppen_not_run(spiele, number_of_gruppen=rules.number_of_gruppen)],
    )


async def find_bracket_faults(
    spiele_collection: AsyncCollection,
    teams_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    spielorte_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    saison_id: str,
) -> tuple[list[FLBracketFault], list[FLSpielJoinedAdmin]]:
    """Every derived fault in one season, and the fixtures they name."""

    # The INTERNAL fixture: `find_departed_occupants` orders a fault on the DAY a club left, which
    # no served side carries. The declared return is the admin shape the caller answers with.
    spiele = FLSpielJoinedInternalListAdapter.validate_python(
        await aggregate_many_from_db(collection=spiele_collection, pipeline=build_spiele_pipeline(db_filter={"saison_id": saison_id}))
    )

    # `find_one` rather than `pull_one_from_db`'s 404: the attention read this report is unioned into
    # answers an id naming no season with an empty list, so the report cannot refuse it.
    saison_raw = await saisons_collection.find_one({"_id": saison_id}, {"rules": 1})

    faults: list[FLBracketFault] = []

    if saison_raw is not None:
        resolution = await _resolve_one_saison(
            teams_collection=teams_collection,
            saison_id=saison_id,
            rules=FLSaisonRules.model_validate(saison_raw["rules"]),
            spiele=spiele,
        )
        faults.extend(resolution.bracket_faults)

    # From the JOINED fixtures, not the resolution: this compares a fixture's date against a junction
    # record, so it sits beside the walk and covers group fixtures too.
    faults.extend(find_departed_occupants(spiele))

    # Beside the walk for the same reason, and over whatever the read above returned. Nothing ties a
    # fixture's `saison_id` to its matchday's, so a scoped read cannot report a clash spanning two.
    faults.extend(find_double_entries(spiele))

    # Beside it too, each a booking rule's state: a bracket resolution, or a side emptied for a Spieltag
    # clash, reopening a fixture stores one without judging it.
    faults.extend(
        find_retired_bookings(
            spiele,
            retired_venues=await _retirement_days(spielorte_collection, {spiel.ort.spielort_id for spiel in spiele if spiel.ort is not None}),
            retired_referees=await _retirement_days(
                schiedsrichter_collection, {spiel.schiedsrichter.schiedsrichter_id for spiel in spiele if spiel.schiedsrichter is not None}
            ),
        )
    )
    claims = [claim for spiel in spiele for claim in find_slot_claims(spiel)]
    faults.extend(find_double_bookings(spiele, await pull_slot_holders(spiele_collection=spiele_collection, claims=claims)))

    faulted_ids = {fault.spiel_id for fault in faults}
    faulted_spiele: list[FLSpielJoinedAdmin] = [spiel for spiel in spiele if spiel.id in faulted_ids]

    return faults, faulted_spiele


async def _retirement_days(collection: AsyncCollection, ids: Set[Any]) -> dict[Any, str]:
    """The day each retired row among `ids` retired; a current row is absent, so the report reads a key missing as current."""

    if not ids:
        return {}

    rows = await pull_many_from_db(
        collection=collection,
        db_filter={"_id": {"$in": list(ids)}, "inactive_since": {"$ne": None}},
        projection={"inactive_since": 1},
        # `_id` is unique, so `len(ids)` rows is the whole answer and the cap can never cut it short.
        limit=len(ids),
    )

    return {row["_id"]: row["inactive_since"] for row in rows}


async def pull_slot_holders(
    *,
    spiele_collection: ReadCollection,
    claims: Sequence[SlotClaim],
    session: AsyncClientSession | None = None,
) -> list[FLSpielSlotHolder]:
    """Every fixture of any season that may hold one of `claims`' rows within the buffer.

    One read for a save's refusal and for its report, so neither can name a clash the other misses.
    """

    if not claims:
        return []

    # A cursor rather than `pull_many_from_db`: the list cap would truncate a busy ground's bookings in silence.
    holders = await spiele_collection.find(
        build_slot_holder_filter(claims),
        {"saison_id": 1, "spiel_nr": 1, "datum": 1, "uhrzeit": 1, "ort": 1, "schiedsrichter": 1},
        session=session,
    ).to_list(length=None)

    # VALIDATED, not read as raw dicts, for the reason `fl_backend/app/api/spiele/schemas.py :: FLSpielBooking` states.
    return FLSpielSlotHolderListAdapter.validate_python(holders)


async def pull_booked_slots(
    *,
    spiele_collection: ReadCollection,
    spiel_id: CustomObjectId,
    claims: Sequence[SlotClaim],
    session: AsyncClientSession | None = None,
) -> list[BookedSlot]:
    """Every other fixture's booking one of `claims` meets, as `spiel_double_booked` compares them.

    `claims` is the caller's choice, and a save judges `find_claims_made`'s rather than every claim
    its fixture makes.
    """

    holders = await pull_slot_holders(spiele_collection=spiele_collection, claims=claims, session=session)

    return [slot for claim in claims for slot in slots_booked_against(claim, holders, spiel_id=spiel_id)]


async def pull_saison_membership(
    saison_teams_collection: ReadCollection,
    saison_id: str,
    session: AsyncClientSession | None = None,
) -> dict[CustomObjectId, SaisonMembership]:
    """Which teams hold a row for this season, under which name, and from which DAY each is out.

    Not `build_team_pipeline`, which withholds a retired club outside `past` seasons: a refusal about
    this season must see its row.
    """

    rows = await pull_many_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_id},
        projection={"team_id": 1, "austritt": 1, "name": 1},
        session=session,
    )

    return {
        row["team_id"]: SaisonMembership(
            name=row["name"],
            # The `.get` is for the null record: a present `austritt` always carries a `datum`.
            departed_from=(row["austritt"] or {}).get("datum"),
        )
        for row in rows
    }


class SpieltagSpan(NamedTuple):
    beginn: str | None
    ende: str | None


async def pull_spieltag_span(
    *,
    spieltage_collection: ReadCollection,
    spieltag_id: CustomObjectId,
    session: AsyncClientSession | None = None,
) -> SpieltagSpan | None:
    """The dates a fixture on this matchday must fall between, or `None` where the id names no matchday.

    `find_one` rather than `pull_one_from_db`'s 404: the date rule leaves a missing matchday alone.
    """

    row = await spieltage_collection.find_one({"_id": spieltag_id}, {"beginn": 1, "ende": 1}, session=session)
    if row is None:
        return None

    # RAW, never through `str()`: a drawn matchday stores a null span, and "None" sorts above every
    # date, so a stringified one would refuse every fixture the season drew.
    return SpieltagSpan(beginn=row["beginn"], ende=row["ende"])


async def pull_booked_venue(
    spielorte_collection: ReadCollection,
    spielort_id: CustomObjectId | None,
    session: AsyncClientSession | None = None,
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
    schiedsrichter_collection: ReadCollection,
    schiedsrichter_id: CustomObjectId | None,
    session: AsyncClientSession | None = None,
) -> BookedReferee | None:
    """The referee this payload's reference names, for the reason `pull_booked_venue` exists."""

    if schiedsrichter_id is None:
        return None

    row = await schiedsrichter_collection.find_one(
        {"_id": schiedsrichter_id}, {"inactive_since": 1, "einwilligung.confirmed_at": 1}, session=session
    )
    if row is None:
        return None

    return BookedReferee(inactive_since=row["inactive_since"], confirmed=is_confirmed(row.get("einwilligung")))


async def anchor_a_booked_venue(
    *,
    spielorte_collection: AsyncCollection,
    spielort_id: CustomObjectId,
    # REQUIRED: the anchor below is what closes the race, so forgetting the session has to be a
    # TypeError at the call rather than a silent reopening of it.
    session: AsyncClientSession,
) -> None:
    """Put a write booking this venue into the write set of `spielort_still_booked`, which reads fixtures and writes the venue."""

    await anchor_in_db(
        collection=spielorte_collection,
        db_filter={"_id": spielort_id},
        session=session,
    )


async def anchor_a_booked_referee(
    *,
    schiedsrichter_collection: AsyncCollection,
    schiedsrichter_id: CustomObjectId,
    # REQUIRED for `anchor_a_booked_venue`'s reason.
    session: AsyncClientSession,
) -> None:
    """Put a write booking this referee in the write set of `schiedsrichter_still_assigned` and of the erasure.

    Both judge fixtures and write this row.
    """

    await anchor_in_db(
        collection=schiedsrichter_collection,
        db_filter={"_id": schiedsrichter_id},
        session=session,
    )


def references_booked_again[Rewrite: (SlotAdvancement, SpieltagRelease)](
    *,
    season: Sequence[FLSpiel],
    rewrites: Sequence[Rewrite],
) -> list[BookedReferences]:
    """Every reference a rewrite books afresh by reopening its fixture.

    Called by the save and its preview alike, so neither anchors what the other leaves alone. A
    rewrite keeps the booking it finds.
    """

    by_id = {spiel.id: spiel for spiel in season}
    booked_again: list[BookedReferences] = []

    for rewrite in rewrites:
        stored = by_id[rewrite.spiel_id]
        # The result goes and only a no-show goes with it: a cancellation names no side and survives, so a
        # called-off fixture stays out of those still to be played.
        reopened = reopens(stored, ergebnis=None, sonderereignis=None if rewrite.voided_sonderereignis is not None else stored.sonderereignis)

        # A lifted no-show claims its slot again even on a fixture that stays unplayed, which `spiel_double_booked` judges.
        if not reopened and rewrite.voided_sonderereignis is None:
            continue

        booked_again.append(
            BookedReferences(
                spielort_id=stored.ort.spielort_id if stored.ort is not None else None,
                schiedsrichter_id=stored.schiedsrichter.schiedsrichter_id if stored.schiedsrichter is not None else None,
            )
        )

    return booked_again


async def preview_bracket_after_patch(
    teams_collection: ReadCollection,
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

    would_hold = [substituted.get(spiel.id, spiel) for spiel in season]
    resolution = await _resolve_one_saison(
        teams_collection=teams_collection,
        saison_id=saison_id,
        rules=rules,
        spiele=would_hold,
    )

    # Raised here as well as at the save, so the preview cannot report a resolution the save refuses:
    # the rail would then invite an edit that 409s on the button beside it.
    refuse(find_advancement_occupancy_refusal(would_hold, resolution.advancements))

    return (
        [report_advancement(advancement) for advancement in resolution.advancements],
        [report_release(release) for release in releases],
        resolution.bracket_faults,
    )


def _stored_side(side: FLSpielTeamField | None) -> Mapping[str, Any] | None:
    """One resolved side as the DOCUMENT stores it; `include` is `FLSpielTeamField`'s field set, so no join can denormalise into it."""

    if side is None:
        return None

    # `keep_oid` keeps `team_id` an ObjectId: stored as a string, it would match no lookup by id.
    return side.model_dump(context={"keep_oid": True}, include=set(FLSpielTeamField.model_fields))


async def advance_bracket_winners(
    spiele_collection: AsyncCollection,
    teams_collection: AsyncCollection,
    saison_id: str,
    rules: FLSaisonRules,
    session: AsyncClientSession,
) -> tuple[list[FLSpielAdvancement], list[FLBracketFault], list[BookedReferences]]:
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

    # Before the first write, so the whole transaction goes back: a resolution refused halfway would
    # leave the season part-advanced, which no later save reproduces and nothing reports as unfinished.
    refuse(find_advancement_occupancy_refusal(spiele, resolution.advancements))

    booked_again = references_booked_again(season=spiele, rewrites=resolution.advancements)

    for advancement in resolution.advancements:
        # The result goes with the occupant: what was scored here
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
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )

    return [report_advancement(advancement) for advancement in resolution.advancements], resolution.bracket_faults, booked_again


def report_advancement(advancement: SlotAdvancement) -> FLSpielAdvancement:
    """One advancement as the response reports it -- the one mapping to the wire shape, so save and preview report alike."""

    return FLSpielAdvancement(
        spiel_id=advancement.spiel_id,
        spiel_nr=advancement.spiel_nr,
        voided_ergebnis=advancement.voided_ergebnis,
        voided_elfmeterschiessen=advancement.voided_elfmeterschiessen,
        voided_sonderereignis=advancement.voided_sonderereignis,
    )


def report_release(release: SpieltagRelease) -> FLSpielReleasedSide:
    """One released side as the response reports it, for the same reason `report_advancement` exists."""

    return FLSpielReleasedSide(
        spiel_id=release.spiel_id,
        spiel_nr=release.spiel_nr,
        side=release.side,
        team_name=release.team_name,
        voided_ergebnis=release.voided_ergebnis,
        voided_elfmeterschiessen=release.voided_elfmeterschiessen,
        voided_sonderereignis=release.voided_sonderereignis,
    )


def _other_side(side: FLSpielSeite) -> FLSpielSeite:
    """The side facing `side`. One spelling, so the model and the `$set` cannot pair the two differently."""

    return "team2" if side == "team1" else "team1"


def apply_release_to_spiel(spiel: FLSpiel, release: SpieltagRelease) -> FLSpiel:
    """One fixture with the released side emptied.

    The PREVIEW's model; the write spells the same rule as a `$set`. The side left behind loses its
    goals too, scored against the team being removed.
    """

    other = _other_side(release.side)
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
    spiele_collection: AsyncCollection,
    # The slice the releases were judged on, which holds every fixture they empty as it stood.
    season: Sequence[FLSpiel],
    releases: Sequence[SpieltagRelease],
    session: AsyncClientSession,
) -> tuple[list[FLSpielReleasedSide], list[BookedReferences]]:
    """Empty each side another fixture gives up so a team can play this Spieltag.

    INSIDE the caller's transaction and BEFORE `advance_bracket_winners`, so the resolution sees the
    released state and can refill the slot.
    """

    booked_again = references_booked_again(season=season, rewrites=releases)

    # Grouped, because a payload can field both clubs of one held fixture: a second `$set` would
    # create `team1.tore` under the null the first wrote -- `PathNotViable`, and the save falls. The
    # report stays per side, so the preview still names both.
    grouped: dict[CustomObjectId, list[SpieltagRelease]] = {}
    for release in releases:
        grouped.setdefault(release.spiel_id, []).append(release)

    for spiel_id, group in grouped.items():
        emptied = {release.side for release in group}
        changes: dict[str, Any] = {"ergebnis": None, "elfmeterschiessen": None}

        for release in group:
            changes[release.side] = None

            # Named, not re-read: reading the fixture again to strip one number would be a second
            # answer. Skipped where the counterpart is itself released -- `team1` beside
            # `team1.tore` in one `$set` is a conflicting path.
            other = _other_side(release.side)
            if release.other_side_present and other not in emptied:
                changes[f"{other}.tore"] = None

            if release.voided_sonderereignis is not None:
                changes["sonderereignis"] = None

        await patch_one_in_db(
            collection=spiele_collection,
            db_filter={"_id": spiel_id},
            update={"$set": changes},
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )

    return [report_release(release) for release in releases], booked_again


@dataclass(frozen=True)
class SpielSaveCollections:
    """Every collection a fixture's save reads or writes, handed on whole so no caller can omit one."""

    spiele: AsyncCollection
    teams: AsyncCollection
    saisons: AsyncCollection
    saison_teams: AsyncCollection
    spieltage: AsyncCollection
    spielorte: AsyncCollection
    schiedsrichter: AsyncCollection
    spielberichte: AsyncCollection


@dataclass(frozen=True)
class _JudgedSave:
    saison_id: str
    rules: FLSaisonRules
    season: list[FLSpiel]
    releases: list[SpieltagRelease]
    patched: FLSpiel
    anchored: BookedReferences


async def _judge_spiel_save(
    *, spiel_id: CustomObjectId, payload: FLPatchSpielDataPayload, collections: SpielSaveCollections, session: AsyncClientSession | None
) -> _JudgedSave:
    """Judge this payload against the fixture's season, and compose the fixture it saves to.

    Every refusal is raised here, so the `dry_run` preview cannot succeed where the save is refused, and the
    normalisation after them composes from rows already judged. The `saison_id` read is what answers 404 for an id no
    fixture holds.
    """

    # `saison_id` alone: everything the judgement and the normalisation read comes from the season slice below.
    stored_raw = await pull_one_from_db(
        collection=collections.spiele, db_filter={"_id": spiel_id}, projection={"saison_id": 1}, session=session
    )
    saison_id = str(stored_raw["saison_id"])

    # Through the session, though the read alone guards nothing: `activate_saison` anchors the fixtures of every season
    # it closes, so a rollover landing under this save conflicts with its write and the retry reads `past`. Ahead of
    # the normalisation because a forfeit is awarded from the rules rather than typed.
    saison_raw = await pull_one_from_db(
        collection=collections.saisons, db_filter={"_id": saison_id}, projection=["rules", "status"], session=session
    )
    rules = FLSaisonRules.model_validate(saison_raw["rules"])

    # One over the cap, so a truncated season is DETECTED rather than judged: a dropped fixture leaves
    # `find_wiring_refusal` reporting a live `spiel_nr` as no such match, and `judge_spieltag_occupancy` blind to a
    # release it owes.
    season_raw = await pull_many_from_db(
        collection=collections.spiele, db_filter={"saison_id": saison_id}, limit=LIST_LIMIT_DEFAULT + 1, session=session
    )
    if len(season_raw) > LIST_LIMIT_DEFAULT:
        raise ValueError(f"season {saison_id} holds more than {LIST_LIMIT_DEFAULT} fixtures, which is more than one read can judge")

    season = FLSpielListAdapter.validate_python(season_raw)
    stored = stored_in_slice(spiel_id, season)

    # First, and on the payload alone: the event the admin just chose is what the rest of this judgement is about, so a
    # contradiction inside it should not be reported as a bracket fault.
    refuse(find_state_refusal(payload))

    # Before the season's own rules: a finished season's record is closed, its bracket and its table included, so
    # nothing about this payload is worth judging further.
    refuse(find_saison_past_refusal(saison_status=str(saison_raw["status"])))

    refuse(find_wiring_refusal(spiel_id, payload, season, number_of_gruppen=rules.number_of_gruppen))

    # Read through the session, so an austritt committed by this transaction is visible.
    membership = await pull_saison_membership(saison_teams_collection=collections.saison_teams, saison_id=saison_id, session=session)
    refuse(find_eligibility_refusal(spiel_id, payload, season, membership))

    # Before the occupancy judgement: a side that cannot be emptied is a fact about this fixture, where a clash is a
    # fact about its neighbours.
    refuse(find_result_removal_refusal(spiel_id, payload, season))

    verdict = judge_spieltag_occupancy(spiel_id, payload, season, membership)
    refuse(verdict.refusal)

    # The session is what makes a matchday widened by a concurrent write visible.
    span = await pull_spieltag_span(spieltage_collection=collections.spieltage, spieltag_id=stored.spieltag_id, session=session)
    if span is not None:
        refuse(find_fixture_date_refusal(datum=payload.datum, spieltag_beginn=span.beginn, spieltag_ende=span.ende))

    # Read whatever the payload names, unchanged reference included: the booking rule judges the row each reference
    # names, and judges the reference alone where it is new or reopened.
    resolved = ResolvedReferences(
        teams=membership,
        ort=await pull_booked_venue(
            spielorte_collection=collections.spielorte,
            spielort_id=payload.ort.spielort_id if payload.ort is not None else None,
            session=session,
        ),
        schiedsrichter=await pull_booked_referee(
            schiedsrichter_collection=collections.schiedsrichter,
            schiedsrichter_id=payload.schiedsrichter.schiedsrichter_id if payload.schiedsrichter is not None else None,
            session=session,
        ),
    )
    # Before the clash: whether a ground exists at all is more basic than who else is on it.
    refuse(find_booking_refusal(spiel_id, payload, season, resolved, rules))

    # Off the slice this transaction judges, so a save retried after a referee's decline conflicted with it meets the
    # slot the decline left; after the booking refusal, which names an erased referee as its own case.
    refuse(find_referee_stand_refusal(stored, payload))

    # Read last, before the one rule it feeds: it spans every season's fixtures.
    booked = await pull_booked_slots(
        spiele_collection=collections.spiele, spiel_id=spiel_id, claims=find_claims_made(stored, payload), session=session
    )
    refuse(find_clash_refusal(datum=payload.datum, uhrzeit=payload.uhrzeit, booked=booked))

    return _JudgedSave(
        saison_id=saison_id,
        rules=rules,
        season=season,
        releases=verdict.releases,
        patched=apply_payload_to_spiel(stored, payload, rules),
        # Returned rather than left to the caller to derive, so every transaction judging here anchors what the two
        # rules above judged.
        anchored=find_references_to_anchor(stored, payload, rules),
    )


async def preview_spiel_save(
    *, spiel_id: CustomObjectId, payload: FLPatchSpielDataPayload, collections: SpielSaveCollections
) -> FLPatchSpielDataResponse:
    """What this payload would move and destroy, judged against the season as it stands and written nowhere.

    No transaction: a preview that took a write lock would be paying for a question.
    """

    judged = await _judge_spiel_save(spiel_id=spiel_id, payload=payload, collections=collections, session=None)
    advanced_to, released_sides, bracket_faults = await preview_bracket_after_patch(
        teams_collection=collections.teams,
        saison_id=judged.saison_id,
        rules=judged.rules,
        season=judged.season,
        patched=judged.patched,
        releases=judged.releases,
    )

    return FLPatchSpielDataResponse(
        advanced_to=advanced_to,
        released_sides=released_sides,
        bracket_faults=bracket_faults,
        version=judged.patched.version,
        bericht_adopted=None,
    )


async def save_spiel_in_session(
    *,
    spiel_id: CustomObjectId,
    payload: FLPatchSpielDataPayload,
    collections: SpielSaveCollections,
    adopts_bericht: int | None,
    now: datetime,
    # REQUIRED: every read here judges what the write stores, so a retry after a write conflict must re-read it all.
    session: AsyncClientSession,
) -> FLPatchSpielDataResponse:
    """Save one fixture wholesale inside the caller's transaction and resolve its season's bracket, as `PATCH /spiele/{id}` does.

    Safe to retry: every pass re-reads what it judges. With `adopts_bericht` the fixture's report is stamped adopted
    where it still stands at that version about the clubs the save leaves; a miss refuses nothing.
    """

    judged = await _judge_spiel_save(spiel_id=spiel_id, payload=payload, collections=collections, session=session)

    # From the NORMALISED fixture, with keys off the PAYLOAD's field set: keys off the fixture would put `saison_id`,
    # `saison_phase`, `spiel_nr` and `spieltag_id` in the `$set`.
    document = judged.patched.model_dump(context={"keep_oid": True}, include={*SPIEL_PATCH_WRITTEN_FIELDS, "ergebnis"})

    await patch_one_in_db(
        collection=collections.spiele,
        db_filter={"_id": spiel_id},
        update={"$set": document},
        expected_version=payload.version,
        session=session,
        return_document=ReturnDocument.BEFORE,
    )

    # Before the resolution: a slot this release opens can be refilled by that same resolution, and the reverse order
    # would leave the season one pass behind.
    released_sides, booked_again_by_the_release = await release_spieltag_sides(
        spiele_collection=collections.spiele, season=judged.season, releases=judged.releases, session=session
    )

    advanced_to, bracket_faults, booked_again_by_the_resolution = await advance_bracket_winners(
        spiele_collection=collections.spiele,
        teams_collection=collections.teams,
        saison_id=judged.saison_id,
        rules=judged.rules,
        session=session,
    )

    # A retirement, the erasure and a rival save at the same hour each judge fixtures and write none of this pass's,
    # so only a write to a row puts what this pass judged in their write sets.
    for booked in (judged.anchored, *booked_again_by_the_release, *booked_again_by_the_resolution):
        if booked.spielort_id is not None:
            await anchor_a_booked_venue(spielorte_collection=collections.spielorte, spielort_id=booked.spielort_id, session=session)
        if booked.schiedsrichter_id is not None:
            await anchor_a_booked_referee(
                schiedsrichter_collection=collections.schiedsrichter, schiedsrichter_id=booked.schiedsrichter_id, session=session
            )

    # After the resolution, which can re-field this fixture's sides and raise its version again.
    saved = await pull_one_from_db(
        collection=collections.spiele,
        db_filter={"_id": spiel_id},
        projection={"team1.team_id": 1, "team2.team_id": 1, VERSION_FIELD: 1},
        session=session,
    )

    # Here and with the session, never after the commit or off it: a save refused or rolled back stamps nothing.
    uebernommen = (
        None
        if adopts_bericht is None
        else await stamp_the_adoption(
            spielberichte_collection=collections.spielberichte,
            spiel_id=spiel_id,
            version=adopts_bericht,
            seiten=seiten_of(saved),
            now=now,
            session=session,
        )
    )

    return FLPatchSpielDataResponse(
        advanced_to=advanced_to,
        released_sides=released_sides,
        bracket_faults=bracket_faults,
        version=saved[VERSION_FIELD],
        bericht_adopted=uebernommen,
    )
