"""
ADMIN · team statistics arithmetic

The two helpers behind `patch_spiel_data`. Statistics are maintained as `$inc` DELTAS rather than
recomputed from scratch, so both functions have to be exactly right or the error accumulates silently
across every subsequent edit.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `get_stats_contribution` returns ALL ZEROS for an unplayed match, including `anzahl_gespielte_spiele`.
    That is what makes a first-time result entry correct: the old contribution is zero across every
    field, so the delta equals the new contribution.
  • Two cases, and they are not interchangeable. Same team in the slot -> apply (new - old). Team
    changed -> revert the old team in full, apply the new team in full.
  • Points are hardcoded 3/1/0. `FLSaison.rules` carries `win_points`/`draw_points` per season and is
    NOT read here. The two agree today; they are not wired together.

 ⚠ KNOWN ISSUE ────────────────────────────────────────────────────────────────────────────────────────────

  This writes `statistik` to the base `teams` collection, filtered by `_id` alone. `GET /teams` READS
  `statistik` from the `saison_teams` junction (`app/api/teams/services.py`). Nothing copies between
  them. Unverified against a running system -- do not "fix" either side before checking.
  Full evidence: docs/0-documentation-ledger.md, Finding F4.
"""

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection

from app.api.teams.schemas import FLTeamStatistik
from app.core.crud import patch_one_in_db
from app.core.exceptions import DocumentNotFoundException


# Helper function for update_spiel_data to calculate a game's exact contribution to a team's statistic
def get_stats_contribution(tore_self: int | None, tore_opponent: int | None) -> FLTeamStatistik:
    if tore_self is None or tore_opponent is None:
        return FLTeamStatistik(
            anzahl_gespielte_spiele=0,
            siege=0,
            niederlagen=0,
            unentschieden=0,
            tore_geschossen=0,
            tore_kassiert=0,
            punkte=0,
        )

    # Create empty (default) statistik object
    team_contribution = FLTeamStatistik(
        anzahl_gespielte_spiele=1,
        siege=0,
        niederlagen=0,
        unentschieden=0,
        tore_geschossen=tore_self,
        tore_kassiert=tore_opponent,
        punkte=0,
    )

    # Victory
    if tore_self > tore_opponent:
        team_contribution.punkte = 3
        team_contribution.siege = 1
    # Draw
    elif tore_self == tore_opponent:
        team_contribution.punkte = 1
        team_contribution.unentschieden = 1
    # Loss
    else:
        team_contribution.niederlagen = 1

    return team_contribution


# Helper function for update_spiel_data, that updates team statistics intelligently
async def update_team_statistik(
    teams_collection: AsyncIOMotorCollection,
    old_team_id: ObjectId,
    new_team_id: ObjectId,
    old_team_contribution: FLTeamStatistik,
    new_team_contribution: FLTeamStatistik,
    session: AsyncIOMotorClientSession,
):

    def _build_increment_dict(contrib_dict: FLTeamStatistik, multiplier: int = 1):
        # Creates the $inc payload, ignoring fields that are 0 to save DB work
        return {f"statistik.{k}": v * multiplier for k, v in contrib_dict.model_dump().items() if (v * multiplier) != 0}

    # Case A: The team in this slot stayed the same
    if old_team_id == new_team_id:
        delta = FLTeamStatistik(
            anzahl_gespielte_spiele=new_team_contribution.anzahl_gespielte_spiele - old_team_contribution.anzahl_gespielte_spiele,
            siege=new_team_contribution.siege - old_team_contribution.siege,
            niederlagen=new_team_contribution.niederlagen - old_team_contribution.niederlagen,
            unentschieden=new_team_contribution.unentschieden - old_team_contribution.unentschieden,
            tore_geschossen=new_team_contribution.tore_geschossen - old_team_contribution.tore_geschossen,
            tore_kassiert=new_team_contribution.tore_kassiert - old_team_contribution.tore_kassiert,
            punkte=new_team_contribution.punkte - old_team_contribution.punkte,
        )

        patch_team_data_operation = await patch_one_in_db(
            collection=teams_collection,
            filter={"_id": old_team_id},
            update={"$inc": _build_increment_dict(delta)},
            session=session,
        )
        if patch_team_data_operation is None:
            raise DocumentNotFoundException(filter={"_id": old_team_id}, error_code="DB-COMMON-001")

    # Case B: The team in this slot changed
    else:
        # Revert the old teams state
        old_team_revert = await patch_one_in_db(
            collection=teams_collection,
            filter={"_id": old_team_id},  # has to be old_team_id
            update={
                "$inc": _build_increment_dict(old_team_contribution, multiplier=-1)
            },  # Has to be old_team_contribution! Multiplier is -1, so that the values are deducted
            session=session,
        )
        if old_team_revert is None:
            raise DocumentNotFoundException(filter={"_id": old_team_id}, error_code="DB-COMMON-001")

        # Apply the changes to the new team
        new_team_apply = await patch_one_in_db(
            collection=teams_collection,
            filter={"_id": new_team_id},  # has to be new_team_id
            update={"$inc": _build_increment_dict(new_team_contribution)},  # Has to be new_team_contribution!
            session=session,
        )
        if new_team_apply is None:
            raise DocumentNotFoundException(filter={"_id": new_team_id}, error_code="DB-COMMON-001")
