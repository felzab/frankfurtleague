from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from http import HTTPStatus
from typing import Any, Final, NamedTuple

from app.api.saisons.schemas import SAISON_FRAME_FIELDS, SAISON_FRAME_ORDER
from app.api.saisons.services import SPIELTAG_POSITION_LOOKUP
from app.api.spiele.services import build_spiele_pipeline
from app.api.spieler.schemas import FLSpielerRolle
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import WriteRefusal
from app.shared.einwilligung import NAME_IS_PUBLIC, is_confirmed
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomObjectId

AS_NAME = "person"

# The surname must not reach the base tier at all, so the initial is composed here rather than by a
# serialiser a later reader could go around. The dot belongs to the value, so the
# one page rendering it joins the two names unchanged.
PUBLIC_LAST_NAME: Mapping[str, Any] = {
    "$cond": {
        # By type, not by `$eq: null`: an absent key and a stored null both mean no surname, and an
        # initial invented for one nobody holds would read as a name.
        "if": {"$eq": [{"$type": "$last_name"}, "string"]},
        # `$substrCP`, never `$substr`: the byte form halves a multi-byte letter, so `Öztürk` breaks.
        "then": {"$concat": [{"$substrCP": ["$last_name", 0, 1]}, "."]},
        "else": None,
    }
}


def public_initial(last_name: str | None) -> str | None:
    """The surname's initial where a `find` serves the read and no aggregation runs.

    `PUBLIC_LAST_NAME` above is the same rule as a Mongo expression. Slicing is by code point, as
    `$substrCP` is.
    """

    # By type, as `PUBLIC_LAST_NAME`'s `$type` test is, and not by `is None`: the two are stated as one
    # rule, so anything the aggregation answers `None` for has to answer `None` here rather than raise.
    if not isinstance(last_name, str):
        return None

    return f"{last_name[:1]}."


def name_is_public(einwilligung: Mapping[str, Any] | None) -> bool:
    """Whether a base-tier read may serve this person's name at all.

    Fails closed, so an absent record, a scope no enum holds and an unconfirmed one each withhold.
    """

    if einwilligung is None:
        return False

    # Both, never the scope alone: publication rests on the person's own confirmation, so a name is
    # withheld unless the stamp reads as one.
    return einwilligung.get("scope") == "kader_public" and is_confirmed(einwilligung)


# The two name fields alone: what a read serves beside a withheld name is that read's to withhold. The
# record is read here and projected nowhere.
PUBLIC_PERSON: Mapping[str, Any] = {
    "first_name": {"$cond": {"if": NAME_IS_PUBLIC, "then": "$first_name", "else": None}},
    "last_name": {"$cond": {"if": NAME_IS_PUBLIC, "then": PUBLIC_LAST_NAME, "else": None}},
}


class PublicPerson(NamedTuple):
    """The two name fields as the base tier serves them."""

    first_name: str | None
    last_name: str | None


def public_person(*, first_name: str | None, last_name: str | None, einwilligung: Mapping[str, Any] | None) -> PublicPerson:
    """`PUBLIC_PERSON` above where a `find` serves the read and no aggregation runs.

    A name handed over as null is served as null: the predicate decides publication and never
    whether a name is there to publish.
    """

    if not name_is_public(einwilligung):
        return PublicPerson(first_name=None, last_name=None)

    return PublicPerson(first_name=first_name, last_name=public_initial(last_name))


# The key a nameless row sorts by, true where the join withheld the name, so those rows come after the named ones.
_NAMELESS = "nameless"

# The squad table's own order: the named rows by position and then the forename served, the nameless ones after them.
# Fixed rather than asked for: ordering by a key reads it out whether or not the response carries it, so no caller
# names one, and the chain stops at the forename, a surname this tier will not serve ordering nothing. The position is
# null on a nameless row, so its place says nothing of it.
SQUAD_ORDER: Mapping[str, int] = {_NAMELESS: 1, "position": 1, "first_name": 1}


# Whether the join withheld the person's name, as the mask answers it.
_NAME_WITHHELD: Mapping[str, Any] = {"$eq": [f"${AS_NAME}.first_name", None]}


def build_spieler_pipeline(*, team_id: CustomObjectId, saison_id: str) -> list[Mapping[str, Any]]:
    """One club's squad in one season as the base tier serves it, run on `saison_spieler`.

    The caller resolves the season, which no default here can. Both terms are required, since a squad is one club's in
    one season and a term left out would serve that club's rows from every season; and they are the whole of what the
    read narrows on, since a term on a field the response withholds rebuilds it from squads of one.
    """

    # First, so the read examines the one club's rows in the one season, through
    # `saison_spieler_saison_id_team_id_de` under the collation the callers pass, and never every person.
    squad_match: dict[str, Any] = {
        "team_id": team_id,
        "saison_id": saison_id,
        # The squad row's retirement. No switch: this tier marks no row it would un-hide.
        "inactive_since": None,
    }

    return [
        {"$match": squad_match},
        {
            "$lookup": {
                "from": Collection.SPIELER,
                "localField": "spieler_id",
                "foreignField": "_id",
                # The mask applied inside the join, so the consent record it reads and every other
                # field of the person never leave the sub-pipeline.
                "pipeline": [{"$project": {"_id": 0, **PUBLIC_PERSON}}],
                "as": AS_NAME,
            }
        },
        # Strict: a squad row naming nobody is a hand edit, and serves no slot.
        {"$unwind": f"${AS_NAME}"},
        # An allow-list: every key here is one the squad table renders. What is projected reaches the
        # page's payload whether rendered or not, so the `stufe`, the squad flags and the joined ids are
        # not projected.
        {
            "$project": {
                # Named to drop the squad row's id, which `$project` keeps otherwise. `spieler_id`
                # goes unnamed: the person's id would tie every row of a pupil whose name is withheld
                # together.
                "_id": 0,
                "first_name": f"${AS_NAME}.first_name",
                "last_name": f"${AS_NAME}.last_name",
                # The number, the position and the captaincy beside a name alone: beside a withheld one they would
                # say which of the squad the nameless row is.
                **{field: {"$cond": {"if": _NAME_WITHHELD, "then": None, "else": f"${field}"}} for field in ("position", "nummer", "rolle")},
                _NAMELESS: _NAME_WITHHELD,
            }
        },
        # After the projection, so `first_name` orders by the name served, which the join masked.
        {"$sort": dict(SQUAD_ORDER)},
        {"$unset": _NAMELESS},
        # One page, as every season-scoped read takes.
        {"$limit": LIST_LIMIT_DEFAULT},
    ]


# The rows inside `max_kader_size`, whichever squad is counted. Retired rows are out: a player who left gave their place
# back. Nominees are out: they stand outside the cap, so entering one neither needs a place nor takes one.
CAPPED_SQUAD_ROW: Mapping[str, Any] = {"inactive_since": None, "is_nachnominiert": False}


def build_live_squad_filter(*, saison_id: str, team_id: CustomObjectId, excluding_spieler_id: CustomObjectId | None) -> Mapping[str, Any]:
    """Which rows of one squad count towards `max_kader_size`.

    The writing player is out so a no-op, a reactivate of a live row, is not refused by its own place; `None` where the
    count is asked for nobody, a registration not yet being a squad row.
    """

    return {
        "saison_id": saison_id,
        "team_id": team_id,
        **CAPPED_SQUAD_ROW,
        **({} if excluding_spieler_id is None else {"spieler_id": {"$ne": excluding_spieler_id}}),
    }


def find_squad_refusal(*, team_in_saison: bool) -> WriteRefusal | None:
    """Why this squad row must be refused, or `None`.

    A shared shirt number is refused on no write path: the model permits it on purpose.
    """

    if not team_in_saison:
        return WriteRefusal(
            error_code=Code.KADER_TEAM_NOT_IN_SAISON,
            status=HTTPStatus.CONFLICT,
        )

    return None


class SquadRoom(NamedTuple):
    """One squad's capped rows and its season's `max_kader_size`."""

    size: int
    cap: int


def find_full_squad_refusal(*, room: SquadRoom, nominee: bool) -> WriteRefusal | None:
    """`kader_full` where the squad takes no further entry, or `None`.

    A nominee stands outside the cap. The one verdict on whether a squad takes an entry, so a write and a read cannot
    disagree. Its own function rather than a clause in `find_squad_refusal`, which answers the club question alone.
    """

    if nominee or room.size < room.cap:
        return None

    return WriteRefusal(
        error_code=Code.KADER_FULL,
        status=HTTPStatus.CONFLICT,
    )


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

    return WriteRefusal(error_code=Code.KADER_ROLLE_TAKEN, status=HTTPStatus.CONFLICT, fields=(("rolle",),))


def build_kader_pipeline(*, saison_id: str, team_id: CustomObjectId | None) -> list[Mapping[str, Any]]:
    """Every squad row of one season, of one team or of all, live and ausgetragen alike, with its person's two names.

    The person tier's read, and the Spieler list's: the surname whole, and no e-mail address, telephone
    number, birthdate or consent record at any depth.
    """

    return [
        {"$match": {"saison_id": saison_id, **({} if team_id is None else {"team_id": team_id})}},
        {
            "$lookup": {
                "from": Collection.SPIELER,
                "localField": "spieler_id",
                "foreignField": "_id",
                # An allow-list inside the join as well as after it: what the join carries is one
                # `$project` edit from the wire, and the person row holds an address.
                "pipeline": [{"$project": {"_id": 0, "first_name": 1, "last_name": 1}}],
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
                "team_id": 1,
                "first_name": "$person.first_name",
                "last_name": "$person.last_name",
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
        {"$sort": {"first_name": 1, "last_name": 1, "spieler_id": 1}},
    ]


def shared_nummern(rows: Sequence[Mapping[str, Any]]) -> frozenset[str]:
    """Each `nummer` two or more live rows of one squad wear, an ausgetragen row wearing none.

    Compared as stored, never as a number: `07` is a printed shirt and not `7`.
    """

    worn = Counter(row["nummer"] for row in rows if row.get("inactive_since") is None and row.get("nummer") is not None)

    return frozenset(nummer for nummer, wearers in worn.items() if wearers > 1)


def mark_shared_nummern(rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Each row with `nummer_double`, in their order, judged against its own team's rows alone."""

    squads: defaultdict[Any, list[Mapping[str, Any]]] = defaultdict(list)
    for row in rows:
        squads[row["team_id"]].append(row)
    shared = {team_id: shared_nummern(squad) for team_id, squad in squads.items()}

    # `shared` holds no null, so a row without a number is never marked.
    return [{**row, "nummer_double": row.get("inactive_since") is None and row.get("nummer") in shared[row["team_id"]]} for row in rows]


def build_held_rollen_filter(*, saison_id: str, team_id: CustomObjectId, excluding_spieler_id: CustomObjectId) -> Mapping[str, Any]:
    """Every other live row of this squad holding a role, whichever: the rows `build_live_rolle_filter` asks after one by one."""

    return {
        "saison_id": saison_id,
        "team_id": team_id,
        "rolle": {"$ne": None},
        "inactive_since": None,
        "spieler_id": {"$ne": excluding_spieler_id},
    }


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


# --- The pupil's own record.


def build_self_pupil_filter(identifier: str) -> Mapping[str, Any]:
    """The one pupil row this address holds.

    The `$type` term is the unique index's partial filter, which an equality alone does not imply.
    """

    return {"email": {"$eq": identifier, "$type": "string"}}


# The order the account read ranks an address's pupil rows in.
SELF_PUPIL_ORDER: Final[Mapping[str, int]] = {"_id": 1}


def build_self_saisons_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """This address's pupil row with every season it holds a squad row in, the newest first, each with its span.

    The consent block is read for the confirmation the caller judges, and no other field of the person.
    """

    return [
        {"$match": build_self_pupil_filter(identifier)},
        {"$project": {"einwilligung": 1}},
        {
            "$lookup": {
                "from": Collection.SAISON_SPIELER,
                "localField": "_id",
                "foreignField": "spieler_id",
                "pipeline": [{"$project": {"_id": 0, "saison_id": 1}}],
                "as": "kader",
            }
        },
        {
            "$lookup": {
                "from": Collection.SAISONS,
                "localField": "kader.saison_id",
                "foreignField": "_id",
                "pipeline": [{"$project": dict.fromkeys(SAISON_FRAME_FIELDS, 1)}, {"$sort": dict(SAISON_FRAME_ORDER)}],
                "as": "saisons",
            }
        },
        {"$project": {"einwilligung": 1, "saisons": 1}},
    ]


_AUFSTELLUNG_AS = "aufstellung"


def _own_spiele_lookup(saison_id: str) -> Mapping[str, Any]:
    """Run on the pupil's squad row: its club's fixtures of the season in the draw's order, each with its matchday and the pupil's `starts`.

    `starts` is read off the club's own line-up, the one keyed by the squad row's club: true or false where it names
    the pupil, null where it does not or none is stored.
    """

    # Both sides spelled out, never `$in` over an array of the two: a fixture's empty side leaves its path missing, and
    # the club's id equals no missing value.
    fields_the_club = {"$or": [{"$eq": ["$team1.team_id", "$$own_team_id"]}, {"$eq": ["$team2.team_id", "$$own_team_id"]}]}
    own_entry = {
        "$first": {
            "$filter": {
                "input": {"$ifNull": [{"$first": f"${_AUFSTELLUNG_AS}.spieler"}, []]},
                "cond": {"$eq": ["$$this.spieler_id", "$$own_spieler_id"]},
            }
        }
    }

    return {
        "$lookup": {
            "from": Collection.SPIELE,
            # Prefixed, so none of the fixture read's own lookups shadows them.
            "let": {"own_team_id": "$team_id", "own_spieler_id": "$spieler_id"},
            "pipeline": [
                *build_spiele_pipeline(db_filter={"saison_id": saison_id, "$expr": fields_the_club}, sort_by=[("spiel_nr", 1)]),
                SPIELTAG_POSITION_LOOKUP,
                {
                    "$lookup": {
                        "from": Collection.AUFSTELLUNGEN,
                        "localField": "_id",
                        "foreignField": "spiel_id",
                        "pipeline": [{"$match": {"$expr": {"$eq": ["$team_id", "$$own_team_id"]}}}, {"$project": {"_id": 0, "spieler": 1}}],
                        "as": _AUFSTELLUNG_AS,
                    }
                },
                # `$ifNull`, so an entry not found serves null rather than leaving the field out.
                {"$set": {"starts": {"$let": {"vars": {"entry": own_entry}, "in": {"$ifNull": ["$$entry.starts", None]}}}}},
                # The club's whole line-up names its other pupils, so it never leaves the read.
                {"$unset": _AUFSTELLUNG_AS},
            ],
            "as": "spiele",
        }
    }


def build_self_saison_pipeline(*, identifier: str, saison_id: str) -> list[Mapping[str, Any]]:
    """This address's pupil row with its squad row of one season, the name its club played the season under, and that club's fixtures.

    `kader` holds that one row or none, `uniq_spieler_id_saison_id` allowing no second; its fixtures ride on it, so a
    pupil holding no row of the season reads none. The consent block is read for the confirmation the caller judges.
    """

    return [
        {"$match": build_self_pupil_filter(identifier)},
        {"$project": {"einwilligung": 1}},
        {
            "$lookup": {
                "from": Collection.SAISON_SPIELER,
                "localField": "_id",
                "foreignField": "spieler_id",
                "pipeline": [
                    {"$match": {"saison_id": saison_id}},
                    {
                        "$lookup": {
                            "from": Collection.SAISON_TEAMS,
                            "let": {"team_id": "$team_id"},
                            "pipeline": [
                                {"$match": {"saison_id": saison_id, "$expr": {"$eq": ["$team_id", "$$team_id"]}}},
                                {"$project": {"_id": 0, "name": 1}},
                            ],
                            "as": "saison_team",
                        }
                    },
                    _own_spiele_lookup(saison_id),
                    {
                        "$project": {
                            "_id": 0,
                            "team_id": 1,
                            # The season row's name, never the club's current one.
                            "team_name": {"$first": "$saison_team.name"},
                            "saison_id": 1,
                            "nummer": 1,
                            "position": 1,
                            "stufe": 1,
                            "rolle": 1,
                            "is_nachnominiert": 1,
                            "inactive_since": 1,
                            "spiele": 1,
                        }
                    },
                ],
                "as": "kader",
            }
        },
    ]
