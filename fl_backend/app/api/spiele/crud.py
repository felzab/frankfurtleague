"""
SPIELE · bracket advancement, and the derived fault list

The one database-facing half of auto-advance. `resolve_bracket` in `services.py` decides what every
slot in a season should hold; this module reads the season, hands it over, and writes back the
fixtures whose answer differs (ADR-0042). `find_bracket_faults` runs the same resolution over every
season and keeps only what it reported, writing nothing (ADR-0047).

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • Both callers go through `_resolve_one_saison`. The fault list an admin re-asks for and the one a
    save reports have to be the same list, and two implementations of the standings read would be two
    answers to who finished second.
  • `find_bracket_faults` writes NOTHING and takes no session. It is a read on an admin route, outside
    any transaction, and reporting a contradiction is never licence to resolve it (ADR-0047).
  • The read takes the caller's SESSION. `advance_bracket_winners` runs after `patch_spiel_data` has
    written the result that triggers it, and a read without the session sees the last committed
    snapshot instead -- so it would resolve the bracket from the match as it was before the write and
    advance nothing.
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

from typing import Mapping, Sequence

from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection

from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import FLBracketFault, FLSpiel, FLSpielListAdapter, FLSpielQuelleGruppe
from app.api.spiele.services import BracketResolution, resolve_bracket
from app.api.teams.schemas import FLGruppenNames, FLTeamListAdapter, FLTeamsFilterParams
from app.api.teams.services import DecidedStanding, build_decided_standings, build_team_pipeline
from app.core.crud import aggregate_many_from_db, patch_one_in_db, pull_many_from_db


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
) -> tuple[list[FLBracketFault], list[FLSpiel]]:
    """
    Every stored bracket fault in every season, and the fixtures they name (ADR-0047).

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
    """

    spiele = FLSpielListAdapter.validate_python(await pull_many_from_db(collection=spiele_collection, db_filter={}))
    saisons_raw = await pull_many_from_db(collection=saisons_collection, db_filter={}, projection={"rules": 1})

    by_saison: dict[str, list[FLSpiel]] = {}
    for spiel in spiele:
        by_saison.setdefault(spiel.saison_id, []).append(spiel)

    faults: list[FLBracketFault] = []
    faulted_ids: set[object] = set()
    faulted_spiele: list[FLSpiel] = []

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

    # The fixtures behind the faults, so the caller can render one as an ordinary card without a second
    # read. Taken from the list already in hand rather than re-queried by id.
    faulted_spiele = [spiel for spiel in spiele if spiel.id in faulted_ids]

    return faults, faulted_spiele


async def advance_bracket_winners(
    spiele_collection: AsyncIOMotorCollection,
    teams_collection: AsyncIOMotorCollection,
    saison_id: str,
    rules: FLSaisonRules,
    session: AsyncIOMotorClientSession,
) -> tuple[list[int], list[FLBracketFault]]:
    """
    Resolve one season's bracket and write back every fixture whose slots disagree with it.

    Returns the `spiel_nr` of each fixture actually written, in ascending order, and every stored fault
    the resolution walked past (ADR-0047). Both are empty for the ordinary edit: a bracket that already
    agrees with its wiring is written to nowhere, and a group still being played reports nothing,
    because a placing that is not decided yet needs no one's attention (ADR-0043).

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
                    "team1": advancement.team1.model_dump(context={"keep_oid": True}) if advancement.team1 is not None else None,
                    "team2": advancement.team2.model_dump(context={"keep_oid": True}) if advancement.team2 is not None else None,
                    "ergebnis": None,
                    "elfmeterschiessen": None,
                }
            },
            session=session,
        )

    return [advancement.spiel_nr for advancement in resolution.advancements], resolution.bracket_faults
