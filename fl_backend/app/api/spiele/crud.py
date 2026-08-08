"""
SPIELE · bracket advancement, the preview of it, and the derived fault list

The one database-facing half of auto-advance. `resolve_bracket` in `services.py` decides what every
slot in a season should hold; this module reads the season, hands it over, and writes back the
fixtures whose answer differs (ADR-0042). `find_bracket_faults` runs the same resolution over every
season and keeps only what it reported, writing nothing (ADR-0047). `preview_bracket_after_patch` runs
it over ONE season rebuilt in memory, which is what `dry_run=true` answers with (ADR-0051).

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • All THREE callers go through `_resolve_one_saison`. The fault list an admin re-asks for, the one a
    save reports and the one a preview promises have to be the same list, and two implementations of
    the standings read would be two answers to who finished second.
  • The preview writes NOTHING and takes no session, exactly as `find_bracket_faults` does. It answers
    a question; a transaction would take a write lock for one.
  • A release is applied BEFORE the resolution, on both paths. A slot the release opened can be
    refilled by the resolution that follows it, so the two orders name different fixtures (ADR-0052).
  • `find_bracket_faults` writes NOTHING and takes no session. It is a read on an admin route, outside
    any transaction, and reporting a contradiction is never licence to resolve it (ADR-0047).
  • The read takes the caller's SESSION. `advance_bracket_winners` runs after `patch_spiel_data` has
    written the result that triggers it, and a read without the session sees the last committed
    snapshot instead -- so it would resolve the bracket from the match as it was before the write and
    advance nothing.
  • The team fields go through `_stored_side`, which dumps the STORED field set and nothing else. The
    read endpoints serve a side carrying a joined `disqualifikation`, and a write that dumped one would
    denormalise it into the document (ADR-0028, rule 4).
  • The team fields are dumped with `context={"keep_oid": True}`. Without it `team_id` serialises to a
    string, the `spiele` `$jsonSchema` validator rejects the write, and the transaction takes the
    admin's own edit down with it.
  • The `$set` NAMES its keys and never writes a whole match document. `ort.mietpreis` and
    `schiedsrichter.payment` record what was agreed for that match, and rewriting them would rewrite
    history (ADR-0028, rule 2).
  • `teamN_quelle` is never written. It describes where a side of the fixture comes from, which stays
    true once the winner arrives (ADR-0041), and clearing it is the admin's only way to take a slot into
    manual charge -- a write here would silently take it back (ADR-0042).
  • The GROUP STANDING is read through `build_team_pipeline`, the same pipeline `GET /teams` uses. A
    second, Python implementation of ADR-0026's counting rule would be a second answer to "how many
    points does this team have", and the bracket and the table would eventually disagree.
  • The standing is read AT ALL only when some slot's `quelle` names a group placing. Deciding a
    group's placings is the expensive half of a result entry, and a group no slot reads from buys
    nothing with it -- a season whose bracket is match-fed end to end never runs the aggregation.
  • Both reads take the caller's SESSION, for the reason above: the standing has to include the result
    this request has just written, or a group that the edit completes still reads as unfinished.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/backend/spec.md -- section 3, the write path step by step
"""

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
    BracketResolution,
    SlotAdvancement,
    SpieltagRelease,
    build_spiele_pipeline,
    find_disqualified_occupants,
    resolve_bracket,
)
from app.api.teams.schemas import FLGruppenNames, FLTeamListAdapter, FLTeamsFilterParams
from app.api.teams.services import DecidedStanding, build_decided_standings, build_team_pipeline
from app.core.crud import aggregate_many_from_db, patch_one_in_db, pull_many_from_db
from app.shared.schemas.custom import CustomObjectId


async def _resolve_one_saison(
    teams_collection: AsyncIOMotorCollection,
    saison_id: str,
    rules: FLSaisonRules,
    spiele: Sequence[FLSpiel],
    session: AsyncIOMotorClientSession | None = None,
) -> BracketResolution:
    """
    One season's bracket resolved against its own standings -- the read half of advancement.

    Shared by the write path, which then writes what disagrees, and by the fault derivation, which
    writes nothing (ADR-0047). Both need the standings computed exactly the same way, and a second
    implementation of that would be a second answer to who finished second.

    The standing is read AT ALL only when some slot's `quelle` names a group placing: deciding a group's
    placings is the expensive half, and a bracket that is match-fed end to end buys nothing with it.
    """

    referenced_gruppen: set[FLGruppenNames] = {
        quelle.gruppe for spiel in spiele for quelle in (spiel.team1_quelle, spiel.team2_quelle) if isinstance(quelle, FLSpielQuelleGruppe)
    }

    standings: Mapping[FLGruppenNames, DecidedStanding] = {}
    if referenced_gruppen:
        # The standing comes from the pipeline that serves `GET /teams`, so the bracket seeds from
        # exactly the table the site shows -- one derivation of ADR-0026's counting rule, not two.
        # `include_inactive` is left at its default for the same reason: a club the list hides must
        # not hold a placing the bracket then honours.
        teams_raw = await aggregate_many_from_db(
            collection=teams_collection,
            pipeline=build_team_pipeline(
                filters=FLTeamsFilterParams(saison_id=saison_id, statistik_scope="gruppenphase"),
                rules=rules,
            ),
            session=session,
        )

        # The group phase alone, matching the scope the statistics above were counted over: a
        # head-to-head drawn from playoff matches would break a tie on results those points never saw
        # (ADR-0029).
        standings = build_decided_standings(
            teams=FLTeamListAdapter.validate_python(teams_raw),
            spiele=[spiel for spiel in spiele if spiel.saison_phase == "gruppenphase"],
            rules=rules,
            gruppen=referenced_gruppen,
        )

    return resolve_bracket(spiele, standings)


async def find_bracket_faults(
    spiele_collection: AsyncIOMotorCollection,
    teams_collection: AsyncIOMotorCollection,
    saisons_collection: AsyncIOMotorCollection,
) -> tuple[list[FLBracketFault], list[FLSpielJoined]]:
    """
    Every derived fault in every season, and the fixtures they name (ADR-0047).

    Derived on demand and stored nowhere. A fault is a contradiction between documents rather than a
    property of one, so no Mongo filter can express it and no `$jsonSchema` validator can refuse it
    (ADR-0027) -- which is why this walks the seasons instead.

    **The cost is one read of `spiele`, one of `saisons`, and one teams aggregation per season whose
    bracket seeds from a group.** A season is about thirty fixtures and the walk over a group's
    outstanding results is trivial once that group has finished, which is when it reports anything at
    all -- but this runs uncached on an admin route, so the per-season aggregation is what grows as
    seasons accumulate.

    The 1024-document cap on the `spiele` read is a ceiling on the WHOLE archive here rather than on one
    season, which is about thirty seasons at today's size. Named because the failure would be silent:
    an unread fixture makes every reference to it read as dangling and reports a fault that is not one.

    **The read is JOINED, and the same documents serve both halves.** The resolution reads none of what
    the join adds -- an `FLSpielJoined` is an `FLSpiel` and the algorithm takes the base shape -- while
    the fixtures returned for display go to the caller's response, which serves the joined shape. One
    read rather than a re-query by id, and the lookup keys on each document's own `saison_id`, which is
    the property that lets this span every season at once.
    """

    spiele = FLSpielJoinedListAdapter.validate_python(
        await aggregate_many_from_db(collection=spiele_collection, pipeline=build_spiele_pipeline(db_filter={}))
    )
    saisons_raw = await pull_many_from_db(collection=saisons_collection, db_filter={}, projection={"rules": 1})

    by_saison: dict[str, list[FLSpiel]] = {}
    for spiel in spiele:
        by_saison.setdefault(spiel.saison_id, []).append(spiel)

    faults: list[FLBracketFault] = []
    faulted_ids: set[object] = set()

    # Sorted, so the report is ordered by season and then -- within `_resolve_one_saison` -- by fixture,
    # rather than by whatever order the two reads came back in.
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

    # The sixth fault, derived from the JOINED fixtures rather than from the resolution (owner,
    # 2026-08-08). It is not a property of the bracket -- it compares a fixture's date against a
    # disqualification recorded on the junction row -- so it sits beside the walk rather than inside it,
    # and it covers group-phase fixtures, which no bracket rule looks at. The join already carries each
    # side's `disqualifikation`, so this costs no extra read.
    occupant_faults = find_disqualified_occupants(spiele)
    faults.extend(occupant_faults)
    faulted_ids.update(fault.spiel_id for fault in occupant_faults)

    # The fixtures behind the faults, so the caller can render one as an ordinary card without a second
    # read. Taken from the list already in hand rather than re-queried by id.
    faulted_spiele = [spiel for spiel in spiele if spiel.id in faulted_ids]

    return faults, faulted_spiele


async def pull_saison_membership(
    saison_teams_collection: AsyncIOMotorCollection,
    saison_id: str,
    session: AsyncIOMotorClientSession | None = None,
) -> dict[CustomObjectId, str | None]:
    """
    Which teams hold a row for this season, and from which DAY each disqualified one is out (ADR-0052).

    Read directly rather than through `build_team_pipeline`: that pipeline serves the league table, so
    it skips seasons a team has no matches in and filters `inactive_since` -- both of which would drop
    a row this refusal has to see. What is needed here is the junction itself, which is the document
    `disqualifikation` actually lives on.

    A team absent from the returned map holds no row at all, which is a distinct refusal from being
    disqualified: the first is a dangling reference and the second is a decision somebody recorded.

    **The value is the disqualification's DATE, not a boolean** (owner, 2026-08-08). A disqualification
    takes effect on a day, so a fixture played before that day was played legally and stays editable --
    entering its result is recording history, not fielding an ineligible team. `find_eligibility_refusal`
    compares the fixture's own date against this, which it cannot do from a boolean.

    Takes the caller's SESSION on the write path, for the reason every read on it does: a
    disqualification written by the same transaction has to be visible to the rule that reads it.
    """

    rows = await pull_many_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_id},
        projection={"team_id": 1, "disqualifikation": 1},
        session=session,
    )

    # `None` for a team that competes, the effective date for one that does not. A row whose
    # `disqualifikation` is present always carries a `datum` -- the validator requires the key and
    # `FLDisqualifikation` requires the field -- so the `.get` is for the null record, not a missing date.
    return {row["team_id"]: (row["disqualifikation"] or {}).get("datum") for row in rows}


async def preview_bracket_after_patch(
    teams_collection: AsyncIOMotorCollection,
    saison_id: str,
    rules: FLSaisonRules,
    season: Sequence[FLSpiel],
    patched: FLSpiel,
    releases: Sequence[SpieltagRelease],
) -> tuple[list[FLSpielAdvancement], list[FLSpielReleasedSide], list[FLBracketFault]]:
    """
    What saving this payload would move and destroy -- computed without writing anything (ADR-0051).

    The season is rebuilt IN MEMORY with the patched fixture and every released side substituted in,
    and then handed to the same `_resolve_one_saison` the save uses. Not a second implementation of
    the resolution and not an approximation of one: it is the resolution, run against a season that
    exists only for the length of this call.

    **No session and no transaction.** Nothing here writes, so there is nothing of its own to see, and
    a preview that opened a transaction would take a write lock for a question.

    The releases are substituted BEFORE resolving, in the order the save applies them, because a
    released slot can be refilled by the resolution that follows it -- and a preview that resolved
    against the unreleased season would name a different set of fixtures than the save moves.
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
    """
    One resolved side as the DOCUMENT stores it -- the stored keys, and never a joined one.

    `include` names the field set of `FLSpielTeamField` rather than dumping whatever the instance
    happens to carry, which is the same guard `patch_spiel_data` puts on its own `$set`. The read
    endpoints serve `FLSpielTeamFieldJoined`, whose `disqualifikation` is looked up per request and
    belongs on no `spiele` document (ADR-0028, rule 4) -- so a joined side reaching this write is the
    one way that decision could be reversed by accident, and it is closed here rather than by
    everyone remembering.

    Derived from the model, so a field added to the stored shape is written without touching this.

    `keep_oid` keeps `team_id` an ObjectId: serialised to a string, the `spiele` `$jsonSchema`
    validator rejects the write and the transaction takes the admin's own edit down with it.
    """

    if side is None:
        return None

    return side.model_dump(context={"keep_oid": True}, include=set(FLSpielTeamField.model_fields))


async def advance_bracket_winners(
    spiele_collection: AsyncIOMotorCollection,
    teams_collection: AsyncIOMotorCollection,
    saison_id: str,
    rules: FLSaisonRules,
    session: AsyncIOMotorClientSession,
) -> tuple[list[FLSpielAdvancement], list[FLBracketFault]]:
    """
    Resolve one season's bracket and write back every fixture whose slots disagree with it.

    Returns one entry per fixture actually written, in ascending `spiel_nr` order, naming **what each
    write destroyed** as well as which fixture moved (ADR-0051) -- plus every stored fault the
    resolution walked past (ADR-0047). Both lists are empty for the ordinary edit: a bracket that
    already agrees with its wiring is written to nowhere, and a group still being played reports
    nothing, because a placing that is not decided yet needs no one's attention (ADR-0043).

    **The whole season is resolved, not only the fixtures fed by the match that changed.** That costs
    one read of about thirty documents on an admin-only path, and it buys a result that does not depend
    on which edit triggered it: a bracket nobody has propagated yet fills itself in on the next save,
    and running the same resolution twice writes nothing the second time.

    Scoped to one season because `spiel_nr` identifies a match within a season and repeats across them
    (`fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`).
    """

    # The helper's 1024-document cap is a comfortable ceiling here, not a risk to size: a season is
    # about thirty fixtures, and a season could only outgrow the cap by two orders of magnitude. Named
    # because the failure would be silent -- a reference to an unread match reads as dangling and the
    # slot is quietly left alone -- so whoever changes what a season can hold finds the boundary here.
    spiele_raw = await pull_many_from_db(
        collection=spiele_collection,
        db_filter={"saison_id": saison_id},
        session=session,
    )
    spiele = FLSpielListAdapter.validate_python(spiele_raw)

    resolution = await _resolve_one_saison(
        teams_collection=teams_collection,
        saison_id=saison_id,
        rules=rules,
        spiele=spiele,
        session=session,
    )

    for advancement in resolution.advancements:
        # `ergebnis` goes with the occupant: an advancement is only ever emitted when a side changed,
        # so whatever was scored here was scored by a team no longer in the fixture. The goals are
        # already stripped from both sides by `resolve_bracket`.
        #
        # `elfmeterschiessen` goes with it for exactly the same reason and must never be left behind:
        # it is the rest of that result, and a shoot-out standing against a fixture with no goals would
        # hand the slot BELOW it a winner derived from a match neither side played (ADR-0044).
        await patch_one_in_db(
            collection=spiele_collection,
            filter={"_id": advancement.spiel_id},
            update={
                "$set": {
                    "team1": _stored_side(advancement.team1),
                    "team2": _stored_side(advancement.team2),
                    "ergebnis": None,
                    "elfmeterschiessen": None,
                }
            },
            session=session,
        )

    return [report_advancement(advancement) for advancement in resolution.advancements], resolution.bracket_faults


def report_advancement(advancement: SlotAdvancement) -> FLSpielAdvancement:
    """
    One advancement as the response reports it: the fixture, and the result the write destroyed.

    The one mapping from the internal write instruction to the wire shape, so the save and the
    `dry_run=true` preview report an identical advancement (ADR-0051). The sides themselves are not
    reported -- the caller re-reads the season anyway, and naming them here would be a second, partial
    copy of the fixture.
    """

    return FLSpielAdvancement(
        spiel_nr=advancement.spiel_nr,
        voided_ergebnis=advancement.voided_ergebnis,
        voided_elfmeterschiessen=advancement.voided_elfmeterschiessen,
    )


def report_release(release: SpieltagRelease) -> FLSpielReleasedSide:
    """One released side as the response reports it, for the same reason `report_advancement` exists."""

    return FLSpielReleasedSide(
        spiel_nr=release.spiel_nr,
        side=release.side,
        team_name=release.team_name,
        voided_ergebnis=release.voided_ergebnis,
        voided_elfmeterschiessen=release.voided_elfmeterschiessen,
    )


def apply_release_to_spiel(spiel: FLSpiel, release: SpieltagRelease) -> FLSpiel:
    """
    One fixture with the released side emptied -- the shape the write below stores and the preview shows.

    Pure, and shared by both for the same reason `apply_payload_to_spiel` is: a preview that models the
    release differently from the write would name the wrong fixtures (ADR-0051).

    **The side left behind loses its goals too**, exactly as an advancement strips both sides: they
    were scored against the team being removed, and goals standing against a fixture with no result is
    the shape `build_statistik_lookup_stage` has to restate a filter to survive.
    """

    other = "team2" if release.side == "team1" else "team1"
    other_side: FLSpielTeamField | None = getattr(spiel, other)

    return spiel.model_copy(
        update={
            release.side: None,
            other: other_side.model_copy(update={"tore": None}) if other_side is not None else None,
            "ergebnis": None,
            "elfmeterschiessen": None,
        }
    )


async def release_spieltag_sides(
    spiele_collection: AsyncIOMotorCollection,
    releases: Sequence[SpieltagRelease],
    session: AsyncIOMotorClientSession,
) -> list[FLSpielReleasedSide]:
    """
    Empty each side another fixture gives up so a team can be fielded on this Spieltag (ADR-0052).

    Runs INSIDE the caller's transaction and BEFORE `advance_bracket_winners`, so the resolution that
    follows sees the released state and can refill a slot the release opened.

    Every side reaching here is one with no `quelle` -- `judge_spieltag_occupancy` refuses the other
    case rather than planning it -- so this never writes over a slot the resolution owns, and
    `teamN_quelle` is not in the `$set` for the same reason it is absent above.
    """

    for release in releases:
        await patch_one_in_db(
            collection=spiele_collection,
            filter={"_id": release.spiel_id},
            update={
                "$set": {
                    release.side: None,
                    # Named rather than derived from the stored document: this transaction has already
                    # read the season, and re-reading a fixture to strip one number would be a second
                    # answer to what it holds. `other_side_tore` says whether there is a side to strip.
                    **({f"{'team2' if release.side == 'team1' else 'team1'}.tore": None} if release.other_side_tore else {}),
                    "ergebnis": None,
                    "elfmeterschiessen": None,
                }
            },
            session=session,
        )

    return [report_release(release) for release in releases]
