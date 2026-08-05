"""
SPIELE · bracket advancement

The one database-facing half of auto-advance. `resolve_bracket` in `services.py` decides what every
slot in a season should hold; this module reads the season, hands it over, and writes back the
fixtures whose answer differs (ADR-0042).

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

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
  • Both reads take the caller's SESSION, for the reason above: the standing has to include the result
    this request has just written, or a group that the edit completes still reads as unfinished.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/backend/spec.md -- section 3, the write path step by step
"""

from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection

from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import FLSpielListAdapter, FLUnresolvableSlot
from app.api.spiele.services import resolve_bracket
from app.api.teams.schemas import FLTeamListAdapter, FLTeamsFilterParams
from app.api.teams.services import build_decided_standings, build_team_pipeline
from app.core.crud import aggregate_many_from_db, patch_one_in_db, pull_many_from_db


async def advance_bracket_winners(
    spiele_collection: AsyncIOMotorCollection,
    teams_collection: AsyncIOMotorCollection,
    saison_id: str,
    rules: FLSaisonRules,
    session: AsyncIOMotorClientSession,
) -> tuple[list[int], list[FLUnresolvableSlot]]:
    """
    Resolve one season's bracket and write back every fixture whose slots disagree with it.

    Returns the `spiel_nr` of each fixture actually written, in ascending order, and the `gruppe`
    references that cannot be honoured at all. Both are empty for the ordinary edit: a bracket that
    already agrees with its wiring is written to nowhere, and a group still being played reports
    nothing, because a placing that is not decided yet needs no one's attention (ADR-0043).

    **The whole season is resolved, not only the fixtures fed by the match that changed.** That costs
    one read of about thirty documents on an admin-only path, and it buys a result that does not depend
    on which edit triggered it: a bracket nobody has propagated yet fills itself in on the next save,
    and running the same resolution twice writes nothing the second time.

    Scoped to one season because `spiel_nr` identifies a match within a season and repeats across them
    (`fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`).
    """

    spiele_raw = await pull_many_from_db(
        collection=spiele_collection,
        db_filter={"saison_id": saison_id},
        session=session,
    )
    spiele = FLSpielListAdapter.validate_python(spiele_raw)

    # The standing comes from the pipeline that serves `GET /teams`, so the bracket seeds from exactly
    # the table the site shows -- one derivation of ADR-0026's counting rule, not two. `include_inactive`
    # is left at its default for the same reason: a club the list hides must not hold a placing the
    # bracket then honours.
    teams_raw = await aggregate_many_from_db(
        collection=teams_collection,
        pipeline=build_team_pipeline(
            filters=FLTeamsFilterParams(saison_id=saison_id, statistik_scope="gruppenphase"),
            rules=rules,
        ),
        session=session,
    )

    # The group phase alone, matching the scope the statistics above were counted over: a head-to-head
    # drawn from playoff matches would break a tie on results those points never saw (ADR-0029).
    standings = build_decided_standings(
        teams=FLTeamListAdapter.validate_python(teams_raw),
        spiele=[spiel for spiel in spiele if spiel.saison_phase == "gruppenphase"],
        rules=rules,
    )

    resolution = resolve_bracket(spiele, standings)

    for advancement in resolution.advancements:
        # `ergebnis` goes with the occupant: an advancement is only ever emitted when a side changed,
        # so whatever was scored here was scored by a team no longer in the fixture. The goals are
        # already stripped from both sides by `resolve_bracket`.
        await patch_one_in_db(
            collection=spiele_collection,
            filter={"_id": advancement.spiel_id},
            update={
                "$set": {
                    "team1": advancement.team1.model_dump(context={"keep_oid": True}) if advancement.team1 is not None else None,
                    "team2": advancement.team2.model_dump(context={"keep_oid": True}) if advancement.team2 is not None else None,
                    "ergebnis": None,
                }
            },
            session=session,
        )

    return [advancement.spiel_nr for advancement in resolution.advancements], resolution.unresolvable_slots
