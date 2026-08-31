from typing import Any, Mapping, Sequence

from app.api.spieler.schemas import FLEinwilligung, FLSpielerFilterParams, FLSpielerRolle
from app.core.collections import Collection
from app.core.crud import build_query, build_sort
from app.core.exceptions import WriteRefusal
from app.shared.schemas.custom import CustomObjectId

AS_NAME = "saison_data"

# `READ-PUPIL-001`: the surname must not reach the base tier at all, so the initial is composed here
# rather than by a serialiser a later reader could go around. The dot belongs to the value, so the
# one page rendering it joins the two names unchanged.
PUBLIC_NACHNAME: Mapping[str, Any] = {
    "$cond": {
        # By type, not by `$eq: null`: an absent key and a stored null both mean no surname, and an
        # initial invented for one nobody holds would read as a name.
        "if": {"$eq": [{"$type": "$nachname"}, "string"]},
        # `$substrCP`, never `$substr`: the byte form halves a multi-byte letter, so `Öztürk` breaks.
        "then": {"$concat": [{"$substrCP": ["$nachname", 0, 1]}, "."]},
        "else": None,
    }
}


def public_initial(nachname: str | None) -> str | None:
    """`READ-PUPIL-001` where a `find` serves the read and no aggregation runs.

    `PUBLIC_NACHNAME` above is the same rule as a Mongo expression. Slicing is by code point, as
    `$substrCP` is.
    """

    # By TYPE, as `PUBLIC_NACHNAME`'s `$type` test is, and not by `is None`: the two are stated as one
    # rule, so anything the aggregation answers `None` for has to answer `None` here rather than raise.
    if not isinstance(nachname, str):
        return None

    return f"{nachname[:1]}."


def build_spieler_pipeline(filters: FLSpielerFilterParams, withheld_saison_ids: Sequence[str] = ()) -> list[Mapping[str, Any]]:
    """`withheld_saison_ids` are the seasons whose rows this read may not serve.

    Empty is the honest default -- a league planning none withholds none -- so the caller that joins
    across seasons is the one supplying them (`app/api/spieler/router.py`).
    """

    pipeline: list[Mapping[str, Any]] = []

    # Terms are NAMED, never excluded: a field added to the filter model would otherwise reach the
    # junction `$match` unreviewed, and a term the response withholds is an inference channel.
    active_filters = build_query(filters, terms={"team_id", "saison_id"})

    # A sub-pipeline, not a post-join `$match`: these narrow the junction BEFORE the rows attach, so
    # the join never carries a season this request did not ask for.
    lookup_pipeline: list[Mapping[str, Any]] = [{"$match": {"$expr": {"$eq": ["$spieler_id", "$$base_spieler_id"]}}}]

    # The SQUAD ROW's retirement, and only ever that (`READ-SQUAD-001`): the same match on the base
    # collection would take a retired person's squad entries down with them. No switch: this tier
    # marks no row it would un-hide (`READ-SQUAD-002`).
    lookup_pipeline.append({"$match": {"inactive_since": None}})

    # No `saison_data.` prefix: inside the sub-pipeline the junction document IS the root.
    if active_filters:
        lookup_pipeline.append({"$match": active_filters})

    # Beside the caller's own terms rather than after the join: a row of a season this tier may not
    # read must never attach, whatever else narrowed. Absent when nothing is withheld, so a league
    # with no season planned runs the pipeline it always ran.
    if withheld_saison_ids:
        lookup_pipeline.append({"$match": {"saison_id": {"$nin": list(withheld_saison_ids)}}})

    pipeline.append(
        {
            "$lookup": {
                "from": Collection.SAISON_SPIELER,
                "let": {"base_spieler_id": "$_id"},
                "pipeline": lookup_pipeline,
                "as": AS_NAME,
            }
        }
    )

    # One row per membership, so a player in two seasons is two documents.
    strict_join = bool(filters.saison_id or filters.team_id)
    pipeline.append(
        {
            "$unwind": {
                "path": f"${AS_NAME}",
                # Preserved unless a season or team filter is set: without one, a player with no
                # squad row is still a player.
                "preserveNullAndEmptyArrays": not strict_join,
            }
        }
    )

    # An ALLOW-LIST: every key here is one the squad table renders. What is projected reaches the
    # page's payload whether rendered or not, so the consent record, the `stufe` (`READ-PUPIL-002`),
    # the squad flags and the joined ids are not projected.
    pipeline.append(
        {
            "$project": {
                "_id": 1,
                "vorname": 1,
                "nachname": PUBLIC_NACHNAME,
                "position": f"${AS_NAME}.position",
                "nummer": f"${AS_NAME}.nummer",
            }
        }
    )

    # After the projection, so a bare field name reaches the root copy rather than the nested one.
    # Through `build_sort` because `sort_by` may itself be `vorname`. The chain stops there: a surname
    # this tier will not serve must not order the list either.
    pipeline.append({"$sort": dict(build_sort(sort_by=filters.sort_by, order=filters.order, chain=(("vorname", 1),)))})

    pipeline.append({"$limit": filters.limit})

    return pipeline


def build_spieler_memberships_pipeline() -> list[Mapping[str, Any]]:
    """Every player with every squad row they hold.

    UNLIKE `build_spieler_pipeline`: no filters, no `$unwind`, no strict join. Sorted by FORENAME
    then surname, and MongoDB sorts a null `nachname` first.
    """

    return [
        {
            "$lookup": {
                "from": Collection.SAISON_SPIELER,
                "localField": "_id",
                "foreignField": "spieler_id",
                "pipeline": [
                    {
                        "$project": {
                            "_id": 0,
                            "saison_id": 1,
                            "team_id": 1,
                            "nummer": 1,
                            "position": 1,
                            "stufe": 1,
                            "is_nachgetragen": 1,
                            "rolle": 1,
                            "inactive_since": 1,
                        }
                    }
                ],
                "as": "memberships",
            }
        },
        {"$sort": {"vorname": 1, "nachname": 1}},
    ]


# The same dangling reference `REQ-ELIGIBILITY-002` refuses on the match side.
SQUAD_TEAM_NOT_IN_SAISON = "REQ-SQUAD-001"

# What every code here refuses is `docs/logging/error-codes.md`.
SQUAD_FULL = "REQ-SQUAD-003"

# One code for both roles, as `REQ-BOOKING-001` covers a venue and a referee: this is one rule read
# against two values rather than two failure modes.
SQUAD_ROLLE_TAKEN = "REQ-SQUAD-004"

# D60's precondition on the erasure: retirement is the reversible half of the same intent, and a
# person still in the league is one somebody would notice missing.
ERASURE_NOT_RETIRED = "REQ-PURGE-001"


def registration_einwilligung(*, today: str) -> FLEinwilligung:
    """The consent record `POST /spieler` composes for a pupil being registered today.

    Composed rather than accepted from the body: no payload carries the field, which is what stops
    an ordinary name correction from rewriting what somebody agreed to.
    """

    return FLEinwilligung(
        umfang="kader_oeffentlich",
        erteilt_von="erziehungsberechtigt",
        datum=today,
        # The same day: registration IS the confirmation here, because the guardian is the one filing it.
        bestaetigt_am=today,
    )


def build_live_squad_filter(*, saison_id: str, team_id: CustomObjectId, excluding_spieler_id: CustomObjectId) -> Mapping[str, Any]:
    """Which rows count towards `max_kadergroesse`.

    Retired rows are out: a player who left gave their place back. The writing player is out so a
    no-op -- an edit keeping the team, a reactivate of a live row -- is not refused by its own place.
    """

    return {
        "saison_id": saison_id,
        "team_id": team_id,
        "inactive_since": None,
        "spieler_id": {"$ne": excluding_spieler_id},
    }


def find_squad_refusal(*, team_in_saison: bool) -> WriteRefusal | None:
    """Why this squad row must be refused, or `None`.

    A shared shirt number is refused on no write path and is declared permitted in
    `fl_backend/app/core/domain.py :: UNENFORCED`.
    """

    if not team_in_saison:
        return WriteRefusal(
            error_code=SQUAD_TEAM_NOT_IN_SAISON,
            message="the named team holds no saison_teams row for this season; a squad entry needs the club to be entered first",
        )

    return None


def find_squad_capacity_refusal(*, squad_size: int, max_kadergroesse: int) -> WriteRefusal | None:
    """Why this squad has no room for another player, or `None`.

    Its own function rather than a clause in `find_squad_refusal`, whose parameters are pinned to the
    club question alone by `tests/core/test_unenforced.py :: TestASharedSquadNumber`.
    """

    if squad_size >= max_kadergroesse:
        noun = "player" if max_kadergroesse == 1 else "players"

        return WriteRefusal(
            error_code=SQUAD_FULL,
            message=f"the squad is full ({squad_size}/{max_kadergroesse} {noun}); a season's rules cap how many players a team may field in it",
        )

    return None


def build_live_rolle_filter(
    *, saison_id: str, team_id: CustomObjectId, rolle: FLSpielerRolle, excluding_spieler_id: CustomObjectId
) -> Mapping[str, Any]:
    """Which rows already hold `rolle` in this squad.

    Retired rows are out, as they are for the cap: a player who left the squad is not leading it. The
    writing player is out so a save that changes something else is not refused by their own armband.
    """

    return {
        "saison_id": saison_id,
        "team_id": team_id,
        "rolle": rolle,
        "inactive_since": None,
        "spieler_id": {"$ne": excluding_spieler_id},
    }


def find_squad_rolle_refusal(*, rolle: FLSpielerRolle | None, taken: bool) -> WriteRefusal | None:
    """Why this squad role may not be given away, or `None`.

    Its own function rather than a clause in `find_squad_refusal`, whose parameters are pinned to the
    club question alone by `tests/core/test_unenforced.py :: TestASharedSquadNumber`.
    """

    # A row holding no role competes with nobody, which is what makes the rule at-most-one rather
    # than exactly-one: a squad still being set up has neither.
    if rolle is None or not taken:
        return None

    return WriteRefusal(
        error_code=SQUAD_ROLLE_TAKEN,
        message=f"another live squad row in this team already holds '{rolle}' for this season; a squad holds each role once",
    )


def find_erasure_refusal(*, inactive_since: str | None) -> WriteRefusal | None:
    """Why this person may not be erased, or `None`.

    Retirement first (`REQ-PURGE-001`): the erasure answers no undo, so the step that does have one
    has to have been taken and left standing.
    """

    if inactive_since is None:
        return WriteRefusal(
            error_code=ERASURE_NOT_RETIRED,
            message="the player is still in the league; retire them first, because an erasure removes every trace and cannot be undone",
        )

    return None
