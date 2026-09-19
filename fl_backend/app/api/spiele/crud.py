from collections.abc import Mapping, Sequence, Set
from dataclasses import replace
from typing import Any, Literal

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.saisons.schemas import FLSaisonRules
from app.api.schiedsrichter.services import ANONYMISIERT_AM
from app.api.spiele.schemas import (
    FLBracketFault,
    FLSpiel,
    FLSpielAdvancement,
    FLSpielCommon,
    FLSpielJoinedAdmin,
    FLSpielJoinedInternalListAdapter,
    FLSpielListAdapter,
    FLSpielPriorOtherFields,
    FLSpielPriorPaarung,
    FLSpielPriorSchiedsrichter,
    FLSpielQuelleGruppe,
    FLSpielReleasedSide,
    FLSpielRestorableField,
    FLSpielSchiedsrichterField,
    FLSpielSlotHolder,
    FLSpielSlotHolderListAdapter,
    FLSpielTeamField,
    FLSpielTeamFieldPayload,
    other_fields_of,
)
from app.api.spiele.services import (
    BookedReferee,
    BookedReferences,
    BookedVenue,
    BracketResolution,
    SaisonMembership,
    SlotAdvancement,
    SlotClaim,
    SpieltagRelease,
    build_slot_holder_filter,
    build_spiele_pipeline,
    find_advancement_occupancy_refusal,
    find_departed_occupants,
    find_double_bookings,
    find_double_entries,
    find_gruppen_not_run,
    find_retired_bookings,
    find_slot_claims,
    reopens,
    resolve_bracket,
    stored_in_slice,
)
from app.api.teams.schemas import FLGruppenNames, FLTeamListAdapter, FLTeamsFilterParams
from app.api.teams.services import (
    ZERO_STATISTIK,
    DecidedStanding,
    build_decided_standings,
    build_statistik_by_team,
    build_team_pipeline,
    offered_gruppen,
)
from app.core.crud import aggregate_many_from_db, patch_many_in_db, patch_one_in_db, pull_many_from_db, refuse
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomObjectId


async def _resolve_one_saison(
    teams_collection: AsyncCollection,
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
    gruppen_to_decide = referenced_gruppen & set(offered_gruppen(rules.number_of_groups))

    standings: Mapping[FLGruppenNames, DecidedStanding] = {}
    if gruppen_to_decide:
        # `GET /teams`' own pipeline, so the bracket ranks the clubs the site's table ranks, and
        # `include_inactive` stays default: a club that table withholds must hold no placing the bracket
        # honours (`docs/backend/spec.md :: I252`). `rules=None` asks it for the ROWS alone.

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
        # walk ranks the preview's (`docs/backend/spec.md :: I98`).
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
        bracket_faults=[*resolution.bracket_faults, *find_gruppen_not_run(spiele, number_of_groups=rules.number_of_groups)],
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
    # clash, reopening a fixture stores one without judging it (`docs/backend/spec.md :: I257`).
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
        # `_id` is unique, so `len(ids)` rows is the whole answer and the cap can never cut it short (`docs/backend/spec.md :: I45`).
        limit=len(ids),
    )

    return {row["_id"]: row["inactive_since"] for row in rows}


async def pull_slot_holders(
    *,
    spiele_collection: AsyncCollection,
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


async def pull_saison_membership(
    saison_teams_collection: AsyncCollection,
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
    spielorte_collection: AsyncCollection,
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
    schiedsrichter_collection: AsyncCollection,
    schiedsrichter_id: CustomObjectId | None,
    session: AsyncClientSession | None = None,
) -> BookedReferee | None:
    """The referee this payload's reference names, for the reason `pull_booked_venue` exists."""

    if schiedsrichter_id is None:
        return None

    row = await schiedsrichter_collection.find_one(
        {"_id": schiedsrichter_id}, {"name": 1, "inactive_since": 1, ANONYMISIERT_AM: 1}, session=session
    )
    if row is None:
        return None

    return BookedReferee(name=row["name"], inactive_since=row["inactive_since"], anonymisiert_am=row[ANONYMISIERT_AM])


async def anchor_a_booked_venue(
    *,
    spielorte_collection: AsyncCollection,
    spielort_id: CustomObjectId,
    # REQUIRED: the anchor below is what closes the race, so forgetting the session has to be a
    # TypeError at the call rather than a silent reopening of it.
    session: AsyncClientSession,
) -> None:
    """Put a write booking this venue into the write set of `REQ-RETIRE-003`, which reads fixtures and writes the venue."""

    await patch_many_in_db(
        collection=spielorte_collection,
        db_filter={"_id": spielort_id},
        # `$inc`, never a `$set` of a constant, which rewrites nothing the second time and joins no write set.
        update={"$inc": {"bounded_writes": 1}},
        session=session,
    )


async def anchor_a_booked_referee(
    *,
    schiedsrichter_collection: AsyncCollection,
    schiedsrichter_id: CustomObjectId,
    # REQUIRED for `anchor_a_booked_venue`'s reason.
    session: AsyncClientSession,
) -> None:
    """Put a write booking this referee into the write set of `REQ-RETIRE-004` and of the erasure: both read fixtures and write the referee."""

    await patch_many_in_db(
        collection=schiedsrichter_collection,
        db_filter={"_id": schiedsrichter_id},
        # `$inc` for `anchor_a_booked_venue`'s reason.
        update={"$inc": {"bounded_writes": 1}},
        session=session,
    )


async def judge_rewritten_bookings[Rewrite: (SlotAdvancement, SpieltagRelease)](
    *,
    schiedsrichter_collection: AsyncCollection,
    season: Sequence[FLSpiel],
    rewrites: Sequence[Rewrite],
    session: AsyncClientSession | None,
) -> tuple[list[Rewrite], list[BookedReferences]]:
    """Each rewrite carrying the erased referee's booking it takes off a fixture it reopens, and every reference it books again.

    The save and its preview both call this, so neither reports a booking the other keeps (`docs/backend/spec.md :: I256`).
    """

    by_id = {spiel.id: spiel for spiel in season}
    judged: list[Rewrite] = []
    booked_again: list[BookedReferences] = []

    for rewrite in rewrites:
        stored = by_id[rewrite.spiel_id]
        # The result goes and only a no-show goes with it: a cancellation names no side and survives, so a
        # called-off fixture stays out of those still to be played.
        reopened = reopens(stored, ergebnis=None, sonderereignis=None if rewrite.voided_sonderereignis is not None else stored.sonderereignis)

        # A lifted no-show claims its slot again even on a fixture that stays unplayed, which `REQ-CLASH-001` judges.
        if not reopened and rewrite.voided_sonderereignis is None:
            judged.append(rewrite)
            continue

        erased = False
        if reopened and stored.schiedsrichter is not None:
            referee = await pull_booked_referee(
                schiedsrichter_collection=schiedsrichter_collection, schiedsrichter_id=stored.schiedsrichter.schiedsrichter_id, session=session
            )
            # The stamp and never the null name (`docs/backend/spec.md :: I214`). A referee merely retired
            # stays, the league being free to reactivate them, and is reported rather than taken off.
            erased = referee is not None and referee.anonymisiert_am is not None

        judged.append(replace(rewrite, voided_schiedsrichter=stored.schiedsrichter) if erased else rewrite)
        booked_again.append(
            BookedReferences(
                spielort_id=stored.ort.spielort_id if stored.ort is not None else None,
                schiedsrichter_id=stored.schiedsrichter.schiedsrichter_id if stored.schiedsrichter is not None and not erased else None,
            )
        )

    return judged, booked_again


async def preview_bracket_after_patch(
    teams_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
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

    releases, _ = await judge_rewritten_bookings(
        schiedsrichter_collection=schiedsrichter_collection, season=season, rewrites=releases, session=None
    )

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

    advancements, _ = await judge_rewritten_bookings(
        schiedsrichter_collection=schiedsrichter_collection, season=would_hold, rewrites=resolution.advancements, session=None
    )

    return (
        [report_advancement(advancement) for advancement in advancements],
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
    spiele_collection: AsyncCollection,
    teams_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
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

    advancements, booked_again = await judge_rewritten_bookings(
        schiedsrichter_collection=schiedsrichter_collection, season=spiele, rewrites=resolution.advancements, session=session
    )

    for advancement in advancements:
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
                    **({"schiedsrichter": None} if advancement.voided_schiedsrichter is not None else {}),
                }
            },
            session=session,
        )

    return [report_advancement(advancement) for advancement in advancements], resolution.bracket_faults, booked_again


def report_advancement(advancement: SlotAdvancement) -> FLSpielAdvancement:
    """One advancement as the response reports it -- the one mapping to the wire shape, so save and preview report alike."""

    return FLSpielAdvancement(
        spiel_id=advancement.spiel_id,
        spiel_nr=advancement.spiel_nr,
        voided_ergebnis=advancement.voided_ergebnis,
        voided_elfmeterschiessen=advancement.voided_elfmeterschiessen,
        voided_sonderereignis=advancement.voided_sonderereignis,
        voided_schiedsrichter=advancement.voided_schiedsrichter,
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
        voided_schiedsrichter=release.voided_schiedsrichter,
    )


def _payload_side(side: FLSpielTeamField | None) -> FLSpielTeamFieldPayload | None:
    """One stored side as a payload names it. The display copies stay behind: the server composes them (`docs/backend/spec.md :: I3`)."""

    return None if side is None else FLSpielTeamFieldPayload(team_id=side.team_id, tore=side.tore)


def _prior_paarung(
    stored: FLSpiel, other_fields: FLSpielPriorOtherFields | None, voided_schiedsrichter: FLSpielSchiedsrichterField | None
) -> FLSpielPriorPaarung:
    return FLSpielPriorPaarung(
        spiel_id=stored.id,
        team1=_payload_side(stored.team1),
        team2=_payload_side(stored.team2),
        elfmeterschiessen=stored.elfmeterschiessen,
        sonderereignis=stored.sonderereignis,
        other_fields=other_fields,
        # The id and the fee alone, as every booking a restore names: the name is composed on the replay (`docs/backend/spec.md :: I3`).
        voided_schiedsrichter=(
            None
            if voided_schiedsrichter is None
            else FLSpielPriorSchiedsrichter(schiedsrichter_id=voided_schiedsrichter.schiedsrichter_id, payment=voided_schiedsrichter.payment)
        ),
    )


def _fields_this_write_replaced(stored: FLSpiel, patched: FLSpiel) -> FLSpielPriorOtherFields | None:
    """The stored value of every field outside the Paarung this write overwrote, `None` where it overwrote none.

    Only the fixture the request named can have any: a bracket resolution reaches the Paarung alone.
    """

    before = other_fields_of(stored)
    after = other_fields_of(patched)
    # Annotated, or pyright widens the mapping's `Literal` key to `str` and the model refuses the list.
    replaced: list[FLSpielRestorableField] = [field for field, value in before.items() if value != after[field]]

    return None if not replaced else FLSpielPriorOtherFields(replaced=replaced, **before)


def report_prior_paarungen(
    edited: CustomObjectId,
    season: Sequence[FLSpiel],
    patched: FLSpiel,
    advanced_to: Sequence[FLSpielAdvancement],
    released_sides: Sequence[FLSpielReleasedSide],
) -> list[FLSpielPriorPaarung]:
    """Every fixture this write changed, off the slice it was judged on.

    Not either report's own view: the releases land before the resolution reads, so a fixture both
    name would report an occupant one write out of date.
    """

    # `edited` is dropped from the set and prepended below instead: the resolution can advance the
    # fixture the request named, and two entries for it would write that fixture twice on one undo.
    moved = {report.spiel_id for report in (*advanced_to, *released_sides)} - {edited}
    stored = sorted((spiel for spiel in season if spiel.id in moved), key=lambda spiel: spiel.spiel_nr)

    # `docs/backend/spec.md :: I108`'s reading: a restore silently short of one fixture leaves it
    # holding exactly what the admin asked to undo.
    if len(stored) != len(moved):
        raise ValueError(f"the season slice does not hold every fixture this write moved, so no restore over it can be trusted: {moved}")

    named = stored_in_slice(edited, season)

    # At most one per fixture: a release writes before the resolution reads, so the resolution finds no
    # booking on a fixture the release already stripped.
    voided = {
        report.spiel_id: report.voided_schiedsrichter for report in (*released_sides, *advanced_to) if report.voided_schiedsrichter is not None
    }

    # LEADING, because a restore replays this list in order: putting the named fixture back frees the
    # occupants the resolution then hands to the moved ones, where the reverse order overwrites them.
    return [
        _prior_paarung(named, _fields_this_write_replaced(named, patched), voided.get(named.id)),
        *(_prior_paarung(spiel, None, voided.get(spiel.id)) for spiel in stored),
    ]


def _other_side(side: Literal["team1", "team2"]) -> Literal["team1", "team2"]:
    """The side facing `side`. One spelling, so the model and the `$set` cannot pair the two differently."""

    return "team2" if side == "team1" else "team1"


def apply_release_to_spiel(spiel: FLSpiel, release: SpieltagRelease) -> FLSpiel:
    """One fixture with the released side emptied.

    The PREVIEW's model; the write spells the same rule as a `$set`, held to it by
    `tests/api/test_spiele_write_execution.py`. The side left behind loses its goals too, scored
    against the team being removed.
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
            **({"schiedsrichter": None} if release.voided_schiedsrichter is not None else {}),
        }
    )


async def release_spieltag_sides(
    spiele_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    # The slice the releases were judged on, which holds every fixture they empty as it stood.
    season: Sequence[FLSpiel],
    releases: Sequence[SpieltagRelease],
    session: AsyncClientSession,
) -> tuple[list[FLSpielReleasedSide], list[BookedReferences]]:
    """Empty each side another fixture gives up so a team can play this Spieltag.

    INSIDE the caller's transaction and BEFORE `advance_bracket_winners`, so the resolution sees the
    released state and can refill the slot.
    """

    releases, booked_again = await judge_rewritten_bookings(
        schiedsrichter_collection=schiedsrichter_collection, season=season, rewrites=releases, session=session
    )

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

            if release.voided_schiedsrichter is not None:
                changes["schiedsrichter"] = None

        await patch_one_in_db(
            collection=spiele_collection,
            db_filter={"_id": spiel_id},
            update={"$set": changes},
            session=session,
        )

    return [report_release(release) for release in releases], booked_again
