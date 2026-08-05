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

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/backend/spec.md -- section 3, the write path step by step
"""

from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection

from app.api.spiele.schemas import FLSpielListAdapter
from app.api.spiele.services import resolve_bracket
from app.core.crud import patch_one_in_db, pull_many_from_db


async def advance_bracket_winners(
    spiele_collection: AsyncIOMotorCollection,
    saison_id: str,
    session: AsyncIOMotorClientSession,
) -> list[int]:
    """
    Resolve one season's bracket and write back every fixture whose slots disagree with it.

    Returns the `spiel_nr` of each fixture actually written, in ascending order — the empty list when
    the bracket already agrees with its labels, which is the ordinary outcome of an edit that changes
    nothing a label points at.

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
    advancements = resolve_bracket(FLSpielListAdapter.validate_python(spiele_raw))

    for advancement in advancements:
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

    return [advancement.spiel_nr for advancement in advancements]
