from collections import Counter
from collections.abc import Mapping, Sequence
from http import HTTPStatus
from typing import Any, NamedTuple

from app.api.adresswechsel.services import LIVE_KEYED_TERMS
from app.api.spieler.schemas import FLSpielerFilterParams, FLSpielerRolle
from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import build_query, build_sort
from app.core.exceptions import WriteRefusal
from app.core.sentinels import GHOST_INACTIVE_SINCE, GHOST_SPIELER_ID
from app.shared.einwilligung import NAME_IS_PUBLIC, is_confirmed
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


def name_is_public(einwilligung: Mapping[str, Any] | None) -> bool:
    """`READ-PUPIL-003`: whether a base-tier read may serve this person's name at all.

    Fails CLOSED, so an absent record, a scope no enum holds and an unconfirmed one each withhold.
    """

    if einwilligung is None:
        return False

    # Both, never the scope alone: publication rests on the person's own confirmation, so a name is
    # withheld unless the stamp reads as one.
    return einwilligung.get("umfang") == "kader_oeffentlich" and is_confirmed(einwilligung)


# The two NAME fields alone: a withheld row keeps its `nummer` and `position`, so a `$cond` reaching
# further would withhold the squad slot rather than the name. The record is read here and projected
# nowhere.
PUBLIC_PERSON: Mapping[str, Any] = {
    "vorname": {"$cond": {"if": NAME_IS_PUBLIC, "then": "$vorname", "else": None}},
    "nachname": {"$cond": {"if": NAME_IS_PUBLIC, "then": PUBLIC_NACHNAME, "else": None}},
}


class PublicPerson(NamedTuple):
    """The two name fields as the base tier serves them."""

    vorname: str | None
    nachname: str | None


def public_person(*, vorname: str | None, nachname: str | None, einwilligung: Mapping[str, Any] | None) -> PublicPerson:
    """`PUBLIC_PERSON` above where a `find` serves the read and no aggregation runs.

    A name handed over as null is served as null: the predicate decides publication and never
    whether a name is there to publish.
    """

    if not name_is_public(einwilligung):
        return PublicPerson(vorname=None, nachname=None)

    return PublicPerson(vorname=vorname, nachname=public_initial(nachname))


def build_ghost_spieler() -> dict[str, Any]:
    """The row an erased pupil's surviving entries are repointed to, as written.

    Nameless and recordless, as `app/api/spieler/schemas.py :: FLSpielerRecord` admits for this row
    alone: a name here is published on every such entry, and a fabricated record is counted as consent.
    """

    return {
        "_id": GHOST_SPIELER_ID,
        "vorname": None,
        "nachname": None,
        "einwilligung": None,
        "geburtsdatum": None,
        "inactive_since": GHOST_INACTIVE_SINCE,
    }


# The one term excluding the sentinel, spelled once for the collection reads and the by-id filter.
_NOT_THE_GHOST: Mapping[str, Any] = {"$ne": GHOST_SPIELER_ID}


def build_real_spieler_filter(terms: Mapping[str, Any] | None = None) -> Mapping[str, Any]:
    """The persons `terms` match, never the sentinel; with none, every person somebody stands behind.

    Takes the caller's terms rather than being spread into them: a spread replaces their own `_id`
    term, an `$in` included, without a word.
    """

    composed = dict(terms or {})

    # Apart under `$and` only where the caller names `_id`, so the caller's own `_id` term is never replaced.
    if "_id" in composed:
        return {"$and": [composed, {"_id": dict(_NOT_THE_GHOST)}]}

    return {**composed, "_id": dict(_NOT_THE_GHOST)}


def build_spieler_filter(spieler_id: Any) -> Mapping[str, Any]:
    """One real person by id, nothing for the sentinel.

    Shared by every route naming a person by id: reached by any, the sentinel takes a name onto every
    erased pupil's entry or a squad row of its own.
    """

    return {"_id": {"$eq": spieler_id, **_NOT_THE_GHOST}}


def build_spieler_pipeline(filters: FLSpielerFilterParams, withheld_saison_ids: Sequence[str] = ()) -> list[Mapping[str, Any]]:
    """`withheld_saison_ids` are the seasons whose rows this read may not serve.

    Empty is the honest default -- a league planning none withholds none -- so the caller that joins
    across seasons is the one supplying them (`app/api/spieler/public_router.py`).
    """

    # First, ahead of the loose join below, which keeps a person holding no squad row.
    pipeline: list[Mapping[str, Any]] = [{"$match": build_real_spieler_filter()}]

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
                # Named to drop it, `$project` keeping `_id` otherwise: the person's own id would tie every
                # squad row of a pupil whose name is withheld together (`READ-PUPIL-005`).
                "_id": 0,
                **PUBLIC_PERSON,
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


def build_spieler_saisons_pipeline() -> list[Mapping[str, Any]]:
    """Every player with every squad row they hold.

    UNLIKE `build_spieler_pipeline`: no caller's filters, no `$unwind`, no strict join. Sorted by FORENAME
    then surname, and MongoDB sorts a null `nachname` first.
    """

    return [
        {"$match": build_real_spieler_filter()},
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
                            "is_nachnominiert": 1,
                            "rolle": 1,
                            "inactive_since": 1,
                            "version": 1,
                        }
                    }
                ],
                "as": "memberships",
            }
        },
        {
            "$lookup": {
                "from": Collection.ADDRESS_CHANGES,
                "localField": "email",
                "foreignField": "adresse",
                # The live change alone: a tombstone's null address would meet every pupil holding none.
                "pipeline": [{"$match": dict(LIVE_KEYED_TERMS)}, {"$project": {"_id": 1}}],
                "as": "adresswechsel",
            }
        },
        {"$set": {"address_change_id": {"$ifNull": [{"$first": "$adresswechsel._id"}, None]}}},
        {"$unset": "adresswechsel"},
        {"$sort": {"vorname": 1, "nachname": 1}},
    ]


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
    `docs/domain.md`'s what the model permits on purpose.
    """

    if not team_in_saison:
        return WriteRefusal(
            error_code=Code.KADER_TEAM_NOT_IN_SAISON,
            status=HTTPStatus.CONFLICT,
        )

    return None


def find_squad_capacity_refusal(*, squad_size: int, max_kadergroesse: int) -> WriteRefusal | None:
    """Why this squad has no room for another player, or `None`.

    Its own function rather than a clause in `find_squad_refusal`, which answers the club question
    alone.
    """

    if squad_size >= max_kadergroesse:
        return WriteRefusal(
            error_code=Code.KADER_FULL,
            status=HTTPStatus.CONFLICT,
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

    Its own function rather than a clause in `find_squad_refusal`, which answers the club question
    alone.
    """

    # A row holding no role competes with nobody, which is what makes the rule at-most-one rather
    # than exactly-one: a squad still being set up has neither.
    if rolle is None or not taken:
        return None

    return WriteRefusal(
        error_code=Code.KADER_ROLLE_TAKEN,
        status=HTTPStatus.CONFLICT,
    )


def build_kader_pipeline(*, saison_id: str, team_id: CustomObjectId) -> list[Mapping[str, Any]]:
    """Every squad row of one team in one season, live and ausgetragen alike, joined to its person's two names.

    The person tier's read (`READ-KADER-001`): the surname whole, and no e-mail address, telephone
    number, birthdate or consent record at any depth.
    """

    return [
        {"$match": {"saison_id": saison_id, "team_id": team_id}},
        {
            "$lookup": {
                "from": Collection.SPIELER,
                "localField": "spieler_id",
                "foreignField": "_id",
                # An allow-list inside the join as well as after it: what the join carries is one
                # `$project` edit from the wire, and the person row holds an address.
                "pipeline": [{"$project": {"_id": 0, "vorname": 1, "nachname": 1}}],
                "as": "person",
            }
        },
        # Strict: the erasure removes a person's squad rows before the person, in one transaction,
        # so a row with no person is a hand edit, left off the squad and answered 404 to a write naming it.
        {"$unwind": "$person"},
        {
            "$project": {
                "_id": 0,
                "spieler_id": 1,
                "vorname": "$person.vorname",
                "nachname": "$person.nachname",
                "nummer": 1,
                "position": 1,
                "stufe": 1,
                "rolle": 1,
                "is_nachnominiert": 1,
                "inactive_since": 1,
                "version": 1,
            }
        },
        # The id last, so two pupils of one name keep one order between two reads.
        {"$sort": {"vorname": 1, "nachname": 1, "spieler_id": 1}},
    ]


def shared_nummern(rows: Sequence[Mapping[str, Any]]) -> frozenset[str]:
    """Each `nummer` two or more LIVE rows of one squad wear, an ausgetragen row wearing none.

    Compared as stored, never as a number: `07` is a printed shirt and not `7` (`docs/domain.md`'s what the model permits on purpose).
    """

    worn = Counter(row["nummer"] for row in rows if row.get("inactive_since") is None and row.get("nummer") is not None)

    return frozenset(nummer for nummer, wearers in worn.items() if wearers > 1)


def mark_shared_nummern(rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Each row with `nummer_double`, judged against the whole squad the rows are."""

    shared = shared_nummern(rows)

    # `shared` holds no null, so a row without a number is never marked.
    return [{**row, "nummer_double": row.get("inactive_since") is None and row.get("nummer") in shared} for row in rows]


def find_kader_stufe_refusal(*, stufe: str | None, stored_stufe: str | None, allowed_stufen: Sequence[str]) -> WriteRefusal | None:
    """`kader_stufe_not_allowed`: the edit writes a Stufe the season's rules do not offer.

    The stored value passes: a season narrowed after the row was written leaves it valid,
    and refusing it would lock the row's other fields too.
    """

    if stufe is None or stufe == stored_stufe or stufe in allowed_stufen:
        return None

    return WriteRefusal(
        error_code=Code.KADER_STUFE_NOT_ALLOWED,
        status=HTTPStatus.CONFLICT,
    )


# --- The pupil's OWN record. What its consent PATCH shares with the referee's and a seat's is
# `app/api/konto/services.py`'s.


def build_self_pupil_filter(identifier: str) -> Mapping[str, Any]:
    """The one pupil row this address holds, retired or not, a withdrawal reaching it either way.

    The `$type` term is the unique index's partial filter, which an equality alone does not imply.
    """

    return {"email": {"$eq": identifier, "$type": "string"}}


def build_self_pupil_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """This address's pupil row with every squad row it holds and the name each club played that season under.

    An allow-list: the sign-in address is the caller's own and still not served back.
    """

    return [
        {"$match": build_self_pupil_filter(identifier)},
        {"$project": {"vorname": 1, "nachname": 1, "geburtsdatum": 1, "inactive_since": 1, "einwilligung": 1}},
        {
            "$lookup": {
                "from": Collection.SAISON_SPIELER,
                "localField": "_id",
                "foreignField": "spieler_id",
                "pipeline": [
                    {
                        "$lookup": {
                            "from": Collection.SAISON_TEAMS,
                            "let": {"team_id": "$team_id", "saison_id": "$saison_id"},
                            "pipeline": [
                                {"$match": {"$expr": {"$and": [{"$eq": ["$team_id", "$$team_id"]}, {"$eq": ["$saison_id", "$$saison_id"]}]}}},
                                {"$project": {"_id": 0, "name": 1}},
                            ],
                            "as": "saison_team",
                        }
                    },
                    {
                        "$project": {
                            "_id": 0,
                            "team_id": 1,
                            "team_name": {"$first": "$saison_team.name"},
                            "saison_id": 1,
                            "nummer": 1,
                            "position": 1,
                            "stufe": 1,
                            "rolle": 1,
                            "is_nachnominiert": 1,
                            "inactive_since": 1,
                        }
                    },
                    # The season a person is playing first: the list is read for what they hold now.
                    {"$sort": {"saison_id": -1, "team_name": 1}},
                ],
                "as": "kader",
            }
        },
        {"$sort": {"_id": 1}},
    ]
