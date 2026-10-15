from collections import Counter
from collections.abc import Mapping, Sequence
from http import HTTPStatus
from typing import Any, Final, NamedTuple

from app.api.bewerbungen.services import days_after
from app.api.spieler.schemas import FLSpielerAdresswechselZustand, FLSpielerFilterParams, FLSpielerRolle
from app.core.collections import Collection
from app.core.crud import build_query, build_sort
from app.core.exceptions import WriteRefusal
from app.core.sentinels import GHOST_INACTIVE_SINCE, GHOST_SPIELER_ID
from app.shared.einwilligung import is_confirmed
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import SPIELER_ADRESSWECHSEL_FRIST_TAGE
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

    # Both, never the scope alone: `app/core/constraints.py :: _EINWILLIGUNG` admits a null
    # `bestaetigt_am`, so `kader_oeffentlich` with no stamp is a scope nobody confirmed. The stamp is
    # the shared predicate's to judge (`docs/backend/spec.md :: I387`), `""` included.
    return einwilligung.get("umfang") == "kader_oeffentlich" and is_confirmed(einwilligung)


# `name_is_public`'s three inputs as a Mongo expression. By `$type` rather than `$eq: null`, for
# `PUBLIC_NACHNAME`'s reason: an absent key and a stored null are one state to a read.
_NAME_IS_PUBLIC: Mapping[str, Any] = {
    "$and": [
        {"$eq": [{"$type": "$einwilligung"}, "object"]},
        {"$eq": ["$einwilligung.umfang", "kader_oeffentlich"]},
        {"$eq": [{"$type": "$einwilligung.bestaetigt_am"}, "string"]},
        # Beside the type test rather than instead of it: `$type` calls `""` a string, so an arm
        # reading the type alone publishes a record nobody confirmed.
        {"$ne": ["$einwilligung.bestaetigt_am", ""]},
    ]
}

# The two NAME fields alone: a withheld row keeps its `nummer` and `position`, so a `$cond` reaching
# further would withhold the squad slot rather than the name. The record is read here and projected
# nowhere.
PUBLIC_PERSON: Mapping[str, Any] = {
    "vorname": {"$cond": {"if": _NAME_IS_PUBLIC, "then": "$vorname", "else": None}},
    "nachname": {"$cond": {"if": _NAME_IS_PUBLIC, "then": PUBLIC_NACHNAME, "else": None}},
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

    Nameless and recordless, as the validator admits for this row alone: a name here is published on
    every such entry, and a fabricated record is counted as consent.
    """

    return {
        "_id": GHOST_SPIELER_ID,
        "vorname": None,
        "nachname": None,
        "einwilligung": None,
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

    # Apart under `$and` only where the caller names `_id`: kept flat otherwise, an address term stays at
    # the top, where `fl_backend/tests/api/test_spieler_email_reads.py :: names_an_address` finds the
    # reads whose plans it checks.
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
    across seasons is the one supplying them (`app/api/spieler/router.py`).
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
                "_id": 1,
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


def build_spieler_memberships_pipeline() -> list[Mapping[str, Any]]:
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
                            # Either stored spelling, `$$REMOVE` where a row carries neither: this
                            # projection decides which keys the model sees, so a bare `1` drops the
                            # marker and a null reaches a `bool` field and 500s the list
                            # (`docs/backend/spec.md :: I302`).
                            "ist_nachnominiert": {"$ifNull": ["$ist_nachnominiert", {"$ifNull": ["$is_nachgetragen", "$$REMOVE"]}]},
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

# What every code here refuses is `fl_backend/app/core/domain.py :: RULES`.
SQUAD_FULL = "REQ-SQUAD-003"

# One code for both roles, as `REQ-BOOKING-001` covers a venue and a referee: this is one rule read
# against two values rather than two failure modes.
SQUAD_ROLLE_TAKEN = "REQ-SQUAD-004"

# The erasure's precondition (`docs/backend/spec.md :: I12`): a person still in the league is one
# somebody would notice missing.
ERASURE_NOT_RETIRED = "REQ-PURGE-001"


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
            status=HTTPStatus.CONFLICT,
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
            status=HTTPStatus.CONFLICT,
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
        status=HTTPStatus.CONFLICT,
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
            status=HTTPStatus.CONFLICT,
            message="the player is still in the league; retire them first, because an erasure removes every trace and cannot be undone",
        )

    return None


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
                # `$ifNull` on every optional key: `$project` omits a missing one rather than nulling
                # it, and the response model requires each key, null or not.
                "nachname": {"$ifNull": ["$person.nachname", None]},
                "nummer": {"$ifNull": ["$nummer", None]},
                "position": {"$ifNull": ["$position", None]},
                "stufe": {"$ifNull": ["$stufe", None]},
                "rolle": {"$ifNull": ["$rolle", None]},
                # Either stored spelling, for `build_spieler_memberships_pipeline`'s reason
                # (`docs/backend/spec.md :: I302`).
                "ist_nachnominiert": {"$ifNull": ["$ist_nachnominiert", {"$ifNull": ["$is_nachgetragen", False]}]},
                "inactive_since": {"$ifNull": ["$inactive_since", None]},
            }
        },
        # The id last, so two pupils of one name keep one order between two reads.
        {"$sort": {"vorname": 1, "nachname": 1, "spieler_id": 1}},
    ]


def shared_nummern(rows: Sequence[Mapping[str, Any]]) -> frozenset[str]:
    """Each `nummer` two or more LIVE rows of one squad wear, an ausgetragen row wearing none.

    Compared as stored, never as a number: `07` is a printed shirt and not `7` (`fl_backend/app/core/domain.py :: UNENFORCED`).
    """

    worn = Counter(row["nummer"] for row in rows if row.get("inactive_since") is None and row.get("nummer") is not None)

    return frozenset(nummer for nummer, wearers in worn.items() if wearers > 1)


def mark_shared_nummern(rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Each row with `nummer_doppelt`, judged against the whole squad the rows are."""

    shared = shared_nummern(rows)

    # `shared` holds no null, so a row without a number is never marked.
    return [{**row, "nummer_doppelt": row.get("inactive_since") is None and row.get("nummer") in shared} for row in rows]


# A representative's edit is held to the season's list, where the administrator's form is trusted to
# offer it (`docs/backend/spec.md :: I158`).
KADER_STUFE_NICHT_ERLAUBT = "REQ-SQUAD-005"


def find_kader_stufe_refusal(*, stufe: str | None, stored_stufe: str | None, erlaubte_stufen: Sequence[str]) -> WriteRefusal | None:
    """`REQ-SQUAD-005`: the edit writes a Stufe the season's rules do not offer.

    The stored value passes: a season narrowed after the row was written leaves it valid
    (`docs/backend/spec.md :: I158`), and refusing it would lock the row's other fields too.
    """

    if stufe is None or stufe == stored_stufe or stufe in erlaubte_stufen:
        return None

    return WriteRefusal(
        error_code=KADER_STUFE_NICHT_ERLAUBT,
        status=HTTPStatus.CONFLICT,
        message="this season's rules do not offer that Stufe; pick one of the season's erlaubte_stufen",
    )


# --- The pupil's OWN record. What its consent PATCH shares with the referee's and a seat's is
# `app/api/konto/services.py`'s.


def build_selbst_pupil_filter(identifier: str) -> Mapping[str, Any]:
    """The one pupil row this address holds, retired or not, a withdrawal reaching it either way.

    The `$type` term is the unique index's partial filter, which an equality alone does not imply.
    """

    # The sentinel by id although it holds no address: a hand edit can give it one, and the id is what names it nobody.
    return build_real_spieler_filter({"email": {"$eq": identifier, "$type": "string"}})


def build_selbst_pupil_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """This address's pupil row with every squad row it holds and the name each club played that season under.

    An allow-list: the sign-in address is the caller's own and still not served back.
    """

    return [
        {"$match": build_selbst_pupil_filter(identifier)},
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
                            # Either stored spelling, as `build_spieler_memberships_pipeline` reads it
                            # (`docs/backend/spec.md :: I302`).
                            "ist_nachnominiert": {"$ifNull": ["$ist_nachnominiert", {"$ifNull": ["$is_nachgetragen", "$$REMOVE"]}]},
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


# --- The ADDRESS CHANGE, duplicated from the referee's rather than shared with it
# (`app/api/schiedsrichter/services.py :: ADRESSWECHSEL_FELD`): the new address waits in a block no
# person's read keys on (`docs/backend/spec.md :: I560`).

# The carrier key, which `app/api/zustellung/services.py :: ZIEL_PFADE` and the erasure's readers also spell.
SPIELER_ADRESSWECHSEL_FELD: Final = "adresswechsel"

# What every code below refuses is `fl_backend/app/core/domain.py :: RULES`.
SPIELER_TOKEN_UNKNOWN = "REQ-SPIELER-001"
SPIELER_TOKEN_EXPIRED = "REQ-SPIELER-002"
SPIELER_ADRESSE_GESPERRT = "REQ-SPIELER-003"
SPIELER_BESTAETIGUNG_GESPERRT = "REQ-SPIELER-004"
# Its own code and never `-004`'s, for `app/api/schiedsrichter/services.py :: SCHIEDSRICHTER_ERSETZTE_ADRESSE_GESPERRT`'s reason.
SPIELER_ERSETZTE_ADRESSE_GESPERRT = "REQ-SPIELER-005"
SPIELER_ADRESSE_VERGEBEN = "REQ-SPIELER-006"
SPIELER_ADRESSE_UNVERAENDERT = "REQ-SPIELER-007"
SPIELER_KEINE_ADRESSE = "REQ-SPIELER-008"


def spieler_adresswechsel_frist_from(*, today: str) -> str:
    """The day the link stops working, counted from the mint -- a re-send restarts it."""

    return days_after(day=today, days=SPIELER_ADRESSWECHSEL_FRIST_TAGE)


def compose_spieler_adresswechsel(*, email: str, token_hash: str, today: str) -> dict[str, Any]:
    """The WHOLE block, so a replaced change's link dies and its message's delivery state goes with it."""

    return {"email": email, "token_hash": token_hash, "verschickt_am": today, "frist": spieler_adresswechsel_frist_from(today=today)}


def build_spieler_adresswechsel_filter(*, token_hash: str) -> Mapping[str, Any]:
    """The hash alone finds the pupil, retired or not: the address is theirs to confirm either way."""

    return {f"{SPIELER_ADRESSWECHSEL_FELD}.token_hash": token_hash}


def build_pending_spieler_adresswechsel_filter(spieler_id: Any) -> Mapping[str, Any]:
    """One real pupil holding a pending change. The filter is the judgement: a pupil holding none answers 404."""

    return {**build_spieler_filter(spieler_id), SPIELER_ADRESSWECHSEL_FELD: {"$type": "object"}}


def spieler_link_is_over(*, frist: Any, today: str) -> bool:
    """`app/api/schiedsrichter/services.py :: link_is_over`'s twin: a block carrying no readable deadline is over."""

    return not isinstance(frist, str) or frist < today


def spieler_adresswechsel_abgelaufen(block: Any, *, today: str) -> bool:
    """Whether a pending block a row holds has passed its deadline, judged as its confirmation refuses."""

    return isinstance(block, Mapping) and spieler_link_is_over(frist=block.get("frist"), today=today)


def holds_an_address(email: Any) -> bool:
    return isinstance(email, str) and email != ""


def find_keine_adresse_refusal(*, email: Any) -> WriteRefusal | None:
    """`REQ-SPIELER-008`: a pupil holding no address takes no change, the request correcting an address and never entering one.

    An address reaches a pupil through the admission of their own confirmed registration alone.
    """

    if holds_an_address(email):
        return None

    return WriteRefusal(
        error_code=SPIELER_KEINE_ADRESSE,
        status=HTTPStatus.CONFLICT,
        message="this pupil holds no email address, so there is none to change; an address arrives with their registration",
    )


def find_adresse_unveraendert_refusal(*, stored: Any, email: str) -> WriteRefusal | None:
    """`REQ-SPIELER-007`: the typed address signs in as the stored one already, so it would ask a mailbox already proved."""

    if not holds_an_address(stored) or sign_in_identifier(email) != sign_in_identifier(str(stored)):
        return None

    return WriteRefusal(
        error_code=SPIELER_ADRESSE_UNVERAENDERT,
        status=HTTPStatus.CONFLICT,
        message="this is the email address the pupil already holds",
    )


def find_spieler_adresse_gesperrt_refusal(*, gesperrt: bool) -> WriteRefusal | None:
    """`REQ-SPIELER-003`: no link goes to an address the ban list holds. Worded for the administrator who typed it."""

    if not gesperrt:
        return None

    return WriteRefusal(
        error_code=SPIELER_ADRESSE_GESPERRT,
        status=HTTPStatus.CONFLICT,
        message="this email address is on the ban list, so no address link may be sent to it; lift the entry first",
    )


def find_adresse_vergeben_refusal(*, vergeben: bool) -> WriteRefusal | None:
    """`REQ-SPIELER-006`: another pupil signs in on this address, and one address is one person (`uniq_spieler_email`)."""

    if not vergeben:
        return None

    return WriteRefusal(
        error_code=SPIELER_ADRESSE_VERGEBEN,
        status=HTTPStatus.CONFLICT,
        message="another pupil's entry holds this email address, and an address belongs to one entry alone",
    )


def find_spieler_token_unknown_refusal(*, found: bool) -> WriteRefusal | None:
    """`REQ-SPIELER-001`, ONE answer for unknown, replaced, answered, discarded and erased, for the referee's twin's reason."""

    if found:
        return None

    return WriteRefusal(
        error_code=SPIELER_TOKEN_UNKNOWN,
        status=HTTPStatus.NOT_FOUND,
        message="this link opens no address change; it may have been replaced by a newer one, or the change is gone",
    )


def find_spieler_token_expired_refusal(*, frist: Any, today: str) -> WriteRefusal | None:
    """`REQ-SPIELER-002`: the link's deadline has passed."""

    if not spieler_link_is_over(frist=frist, today=today):
        return None

    return WriteRefusal(
        error_code=SPIELER_TOKEN_EXPIRED,
        status=HTTPStatus.GONE,
        message="this link has expired; the administration can send a fresh one",
    )


def find_spieler_bestaetigung_gesperrt_refusal(*, gesperrt: bool) -> WriteRefusal | None:
    """`REQ-SPIELER-004`: the ban list holds the address this link was mailed to, however long ago it was minted."""

    if not gesperrt:
        return None

    # 403 where the editor's `-003` is 409, for the referee's twin's reason: this caller is the barred person.
    return WriteRefusal(
        error_code=SPIELER_BESTAETIGUNG_GESPERRT,
        status=HTTPStatus.FORBIDDEN,
        message="the email address this link was sent to is on the ban list, so it confirms nothing",
    )


def find_spieler_ersetzte_adresse_gesperrt_refusal(*, gesperrt: bool) -> WriteRefusal | None:
    """`REQ-SPIELER-005`: the ban list holds the address this change would replace, so moving it would carry the ban's person off it."""

    if not gesperrt:
        return None

    return WriteRefusal(
        error_code=SPIELER_ERSETZTE_ADRESSE_GESPERRT,
        status=HTTPStatus.CONFLICT,
        message="this address change can no longer be confirmed; the address on file stays",
    )


def replaces_a_pending_address(*, stored: Mapping[str, Any], email: str) -> bool:
    """Whether a request drops a pending address for another one, which then leaves the log as a decline's does.

    Compared on the fold, as every other judgement of a pupil's address is: typing the pending one again drops nothing.
    """

    pending = (stored.get(SPIELER_ADRESSWECHSEL_FELD) or {}).get("email")

    return isinstance(pending, str) and sign_in_identifier(pending) != sign_in_identifier(email)


def spieler_adresswechsel_image_edits(image: Mapping[str, Any], identifier: str) -> dict[str, None]:
    """The pending block in one log image of a pupil, emptied where it names this mailbox on the fold.

    The rest of the image stays: the pupil's earlier states are theirs, and a restore starts from them.
    """

    wechsel = image.get(SPIELER_ADRESSWECHSEL_FELD)
    email = wechsel.get("email") if isinstance(wechsel, Mapping) else None

    return {SPIELER_ADRESSWECHSEL_FELD: None} if isinstance(email, str) and sign_in_identifier(email) == identifier else {}


def compose_spieler_adresswechsel_antwort(*, antwort: str, email: Any) -> Mapping[str, Any]:
    """The ONE update an answer is: a confirmation moves the address and ends the change, a decline ends it alone.

    Neither touches `einwilligung`: the link proves a mailbox and asks no consent.
    """

    if antwort == "bestaetigt":
        # Folded, never as typed: the sign-in seam joins on this field by equality (`docs/backend/spec.md :: I265`).
        return {"$set": {"email": sign_in_identifier(str(email))}, "$unset": {SPIELER_ADRESSWECHSEL_FELD: ""}}

    return {"$unset": {SPIELER_ADRESSWECHSEL_FELD: ""}}


def spieler_adresswechsel_zustand_of(
    *, wechsel: Mapping[str, Any], today: str, gesperrt: bool, ersetzte_gesperrt: bool, vergeben: bool
) -> FLSpielerAdresswechselZustand:
    """What the link shows, ranked as the referee's twin ranks it (`app/api/schiedsrichter/services.py :: adresswechsel_zustand_of`).

    A replaced address the ban list holds and a new one another pupil holds read alike, so the link's
    holder learns neither.
    """

    if gesperrt:
        return "gesperrt"

    if spieler_link_is_over(frist=wechsel.get("frist"), today=today):
        return "abgelaufen"

    return "nicht_bestaetigbar" if ersetzte_gesperrt or vergeben else "gueltig"


# An INCLUSION, for `app/api/schiedsrichter/services.py :: BESTAETIGUNG_ANSICHT_FIELDS`' reason. Both
# addresses are read for the ban list and the holder check alone, and no answer carries either.
SPIELER_ADRESSWECHSEL_ANSICHT_FIELDS: Mapping[str, int] = {
    "vorname": 1,
    "email": 1,
    f"{SPIELER_ADRESSWECHSEL_FELD}.email": 1,
    f"{SPIELER_ADRESSWECHSEL_FELD}.frist": 1,
}


def spieler_adresswechsel_adressen(raw: Mapping[str, Any]) -> tuple[str, str]:
    """The address the link was mailed to and the one it would replace, as the ban list is asked about them."""

    wechsel = raw.get(SPIELER_ADRESSWECHSEL_FELD) or {}

    return str(wechsel.get("email") or ""), str(raw.get("email") or "")


# What the request and the re-send judge and answer: both addresses, and the first name both mails greet with.
SPIELER_ADRESSWECHSEL_MINT_FIELDS: Mapping[str, int] = {"vorname": 1, "email": 1, f"{SPIELER_ADRESSWECHSEL_FELD}.email": 1}
