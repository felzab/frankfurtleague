from collections.abc import Mapping, Sequence
from datetime import date, datetime, time, timedelta
from http import HTTPStatus
from typing import Any, Final

from app.api.saisons.schemas import SAISON_FRAME_FIELDS, SAISON_FRAME_ORDER
from app.api.saisons.services import SAISON_AS, SAISON_LOOKUP
from app.api.schiedsrichter.schemas import FLSchiedsrichterSpiel
from app.api.spielberichte.services import takes_a_bericht
from app.api.spielbestaetigungen.crud import JUDGED_JUNCTION_FIELDS, JUDGED_SPIEL_FIELDS, OWN_ROW_FIELDS
from app.api.spielbestaetigungen.services import AnsetzungState, exit_ends_the_booking, schiedsrichter_state_of
from app.api.spiele.schemas import SONDEREREIGNIS_KEEPING_ITS_SLOT, FLSpielortFieldPublic, is_played, unplayed_filter
from app.api.spiele.services import build_named_spiele_pipeline
from app.core import clock
from app.core.clock import days_after
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError, link_expired
from app.shared.einwilligung import is_confirmed
from app.shared.einwilligung_evidence import TextVersions, compose_initial
from app.shared.folding import league_address, sign_in_identifier
from app.shared.links import deadline_passed
from app.shared.saison import season_has_ended
from app.shared.schemas.bounds import CONFIRMATION_DEADLINE_DAYS
from app.shared.schemas.literals import FLConfirmationState


def build_assignment_filter(schiedsrichter_id: Any) -> Mapping[str, Any]:
    """Every fixture naming this referee, played or not — the set the erasure partitions."""

    return {"schiedsrichter.schiedsrichter_id": schiedsrichter_id}


def build_unplayed_assignment_filter(schiedsrichter_id: Any) -> Mapping[str, Any]:
    """Every fixture this referee holds that is still to be played, which is what the retirement's refusal judges.

    Composed from `build_assignment_filter` rather than spelled again, so the path cannot be
    narrowed on one seam alone.
    """

    return {**build_assignment_filter(schiedsrichter_id), **unplayed_filter()}


def find_referee_name_refusal(*, taken: bool) -> APIError | None:
    """`duplicate_key` on the name: another referee, a retired one included, holds it.

    Takes the answer rather than the lookup, so the caller's read runs in the caller's transaction. The unique index still
    answers a race between two writes, as `duplicate_key` with no field.
    """

    if not taken:
        return None

    return APIError(HTTPStatus.CONFLICT, Code.DUPLICATE_KEY, fields=(("name",),))


def find_referee_retire_refusal(*, upcoming_spiel_nrs: Sequence[int]) -> APIError | None:
    """Why retiring this referee must be refused, or `None`.

    `upcoming_spiel_nrs` are the fixtures still to be played that book them, named with their count on the path's id.
    """

    if not upcoming_spiel_nrs:
        return None

    return APIError(
        HTTPStatus.CONFLICT,
        Code.SCHIEDSRICHTER_STILL_ASSIGNED,
        fields=(("schiedsrichter_id",),),
        location="path",
        bounds={"spiel_nrs": list(upcoming_spiel_nrs), "count": len(upcoming_spiel_nrs)},
    )


# Every predicate below reads a null `confirmation` block as "nothing was ever mailed": a retired referee whose
# corrected address was stored unmailed holds none.


# The record's confirmation block, under which the hand-out stores the hashes it mints.
CONFIRMATION_FIELD: Final = "confirmation"

# Where the hand-out stores the hashes of the links it mints, and the address it mints them for.
TOKEN_HASHES_PATH: Final = f"{CONFIRMATION_FIELD}.token_hashes"
ADDRESS_PATH: Final = "kontakt.email"

EINWILLIGUNG_FIELD: Final = "einwilligung"

# The instant the hourly pass erases an unanswered entry, its bookings and confirmation rows with it, which a
# TTL index deleting the row could not do. On the record rather than inside the block: a retired referee's corrected
# address nulls the block, and the entry its person never confirmed still goes on the clock its last link started.
ERASE_AT_FIELD: Final = "erase_at"


def build_erasure_due_filter(*, now: datetime) -> Mapping[str, Any]:
    """Every entry whose deletion date has passed: a confirmed entry holds none, so it is never due."""

    return {ERASE_AT_FIELD: {"$lte": now}}


def confirmation_deadline_from(*, today: str) -> str:
    """The day the link stops working, counted from the mint -- a re-send restarts it."""

    return days_after(day=today, days=CONFIRMATION_DEADLINE_DAYS)


def erase_at_from(*, deadline: str) -> datetime:
    """The German midnight closing the deadline's day: the link still answers on that day, so the entry outlives it."""

    return datetime.combine(date.fromisoformat(deadline) + timedelta(days=1), time(), tzinfo=clock.GERMANY)


def compose_confirmation(*, today: str) -> dict[str, Any]:
    """The bookkeeping every owed link writes: no hash until the hand-out mints one, owed today."""

    return {"token_hashes": [], "sent_at": today, "deadline": confirmation_deadline_from(today=today)}


def compose_entry(*, today: str) -> dict[str, Any]:
    """What a create stores beside the payload: no consent and no birthdate yet, as a stored null, and the first link owed.

    Null rather than absent, as a registration stores it, so every referee holds every key its record model requires.
    """

    return {EINWILLIGUNG_FIELD: None, "birth_date": None, **compose_mint_update(today=today)}


def compose_mint_update(*, today: str) -> dict[str, Any]:
    """The whole block, so every link the referee was sent before stops working at this write, and the clock it restarts."""

    return {
        CONFIRMATION_FIELD: compose_confirmation(today=today),
        ERASE_AT_FIELD: erase_at_from(deadline=confirmation_deadline_from(today=today)),
    }


def compose_einwilligung(*, scope: str, media: bool, today: str) -> dict[str, Any]:
    """The record as the person's own press writes it.

    `date` and `confirmed_at` are one day here where a pupil's are two: nobody enters this record
    administratively, so it is given and confirmed in the same press.
    """

    return {
        "scope": scope,
        "date": today,
        "confirmed_at": today,
        "media": media,
    }


def compose_confirmation_update(
    *, birth_date: str, scope: str, media: bool, text_versions: TextVersions, today: str, at: str
) -> Mapping[str, Any]:
    """The one `$set` a confirmation is.

    Never two writes: between them the row would hold a birthdate nobody had yet consented to the
    league keeping.
    """

    # Born whole rather than moved: the stamp refusal admits only a row whose stored block no answer
    # of this referee's stands on, and a dotted `$set` under a null block aborts the transaction.
    record = compose_initial(block=compose_einwilligung(scope=scope, media=media, today=today), at=at, text_versions=text_versions)

    # The clock goes with the answer: a confirmed entry stays until its person or the league ends it.
    return {"$set": {"birth_date": birth_date, EINWILLIGUNG_FIELD: record, ERASE_AT_FIELD: None}}


def build_token_filter(*, token_hash: str) -> Mapping[str, Any]:
    """The hash alone finds the referee. No `inactive_since` term: a person retired after the mint still owns the answer they give."""

    return {TOKEN_HASHES_PATH: token_hash}


def confirmation_expired(block: Mapping[str, Any] | None, *, today: str) -> bool:
    """Whether the link a referee holds has passed its deadline; false where they hold none."""

    return block is not None and deadline_passed(deadline=block["deadline"], today=today)


def state_of(*, einwilligung: Any, confirmation: Mapping[str, Any], today: str) -> FLConfirmationState:
    """What a reopened link shows: an answer over the deadline. An objection erased the entry, so no link of it opens.

    A person who answered on the last valid day is shown that they did.
    """

    if is_confirmed(einwilligung=einwilligung):
        return "confirmed"

    return "expired" if deadline_passed(deadline=confirmation["deadline"], today=today) else "valid"


def answered_at_of(*, state: FLConfirmationState, einwilligung: Any) -> str | None:
    """The day of the consent `state` shows; `None` where it shows none."""

    return str(einwilligung["confirmed_at"]) if state == "confirmed" else None


def find_expired_token_refusal(*, deadline: str, today: str) -> APIError | None:
    """Why this link is over, or `None`."""

    return link_expired() if deadline_passed(deadline=deadline, today=today) else None


def find_already_answered_refusal(*, einwilligung: Any) -> APIError | None:
    """Why this entry takes no second answer, or `None`. The single use: the consent's stamp spends the link, and an objection erases it."""

    # The answer and never a nulled hash: the hash stays live so a second press is told why.
    if not is_confirmed(einwilligung=einwilligung):
        return None

    return APIError(HTTPStatus.CONFLICT, Code.CONFIRMATION_EXISTS)


def find_retired_refusal(*, inactive_since: Any) -> APIError | None:
    """Why a retired referee takes no fresh link, or `None`.

    A refusal to collect and never a retire-first gate: a row taking no new booking would be asked
    to consent to a role nobody can give them.
    """

    if inactive_since is None:
        return None

    return APIError(HTTPStatus.CONFLICT, Code.SCHIEDSRICHTER_RETIRED)


def find_missing_address_refusal(*, email: str) -> APIError | None:
    """Why there is nobody to send to, or `None`: a stored address the fold cannot canonicalise, such as a placeholder.

    Refused here and not at the calling surface alone: a mint that wrote `sent_at` for a row
    with no address would record a message that was never composed.
    """

    try:
        league_address(email)
    except ValueError:
        return APIError(HTTPStatus.CONFLICT, Code.SCHIEDSRICHTER_NO_ADDRESS)

    return None


def _address_moves(*, stored: Mapping[str, Any], payload_email: str) -> bool:
    # Both the fold every payload stores, so one string is one mailbox.
    return payload_email != stored["kontakt"]["email"]


def save_moves_the_link(*, stored: Mapping[str, Any], payload_email: str) -> bool:
    """Whether a save retires the referee's link or mints a fresh one: an unanswered referee's address moving to another mailbox."""

    # A confirmed referee's address is never the save's (`find_confirmed_address_refusal`).
    if is_confirmed(einwilligung=stored.get(EINWILLIGUNG_FIELD)):
        return False

    return _address_moves(stored=stored, payload_email=payload_email)


def find_confirmed_address_refusal(*, stored: Mapping[str, Any], payload_email: str) -> APIError | None:
    """`schiedsrichter_address_only_per_change`: a save moving a confirmed referee's address, which keys their sign-in.

    Only an address change moves it. Refused whole: landing the rest, an editor stale on the address would lose its other fields unseen.
    """

    if not is_confirmed(einwilligung=stored.get(EINWILLIGUNG_FIELD)) or not _address_moves(stored=stored, payload_email=payload_email):
        return None

    return APIError(HTTPStatus.CONFLICT, Code.SCHIEDSRICHTER_ADDRESS_ONLY_PER_CHANGE)


def compose_correction_update(
    *, stored: Mapping[str, Any], payload: Mapping[str, Any], payload_email: str, today: str
) -> tuple[dict[str, Any], bool]:
    """The save's update, and whether it owes a fresh consent link.

    A retired unconfirmed referee's new address is stored and mailed nothing, and their old link
    goes, its mailbox replaced; the reactivation is what asks them.
    """

    if not save_moves_the_link(stored=stored, payload_email=payload_email):
        return {"$set": dict(payload)}, False

    if stored.get("inactive_since") is not None:
        return {"$set": {**payload, CONFIRMATION_FIELD: None}}, False

    # An unconfirmed referee's old link went to a mailbox nobody reads, and leaving it live is a
    # credential in the wrong inbox.
    return {"$set": {**payload, **compose_mint_update(today=today)}}, True


def owes_reactivation_mint(*, stored: Mapping[str, Any]) -> bool:
    """Whether bringing this referee back mints them a link: retired, unconfirmed, and holding an address a link can go to.

    A row with no such address comes back unasked; entering one is the save that mints.
    """

    return (
        stored.get("inactive_since") is not None
        and not is_confirmed(einwilligung=stored.get(EINWILLIGUNG_FIELD))
        and find_missing_address_refusal(email=stored["kontakt"]["email"]) is None
    )


# What the link's view and its two answers read. An inclusion and never an exclusion: a base-tier caller holds the whole
# credential, so the rest of the row is what must not reach them. The `_id` it carries keys an answer's write, and the
# view builds its answer field by field; an answer takes its wording from the payload rather than the row.
CONFIRMATION_FIELDS: Mapping[str, int] = {
    f"{EINWILLIGUNG_FIELD}.confirmed_at": 1,
    f"{CONFIRMATION_FIELD}.deadline": 1,
}

# What a fresh link is judged on, and the address it is mailed to.
INVITE_FIELDS: Mapping[str, int] = {
    "inactive_since": 1,
    "kontakt.email": 1,
    f"{EINWILLIGUNG_FIELD}.confirmed_at": 1,
}


def build_self_referee_filter(*identifiers: str, schiedsrichter_id: Any = None) -> Mapping[str, Any]:
    """The referee rows of these addresses, retired ones included: a withdrawal reaches them too."""

    return {
        # Folded here, the form every referee record stores.
        "kontakt.email": {"$in": sorted({sign_in_identifier(identifier) for identifier in identifiers})},
        **({} if schiedsrichter_id is None else {"_id": schiedsrichter_id}),
    }


# The order the account read ranks a person's referee rows in.
SELF_REFEREE_ORDER: Final[Mapping[str, int]] = {"_id": 1}


def build_self_saisons_pipeline(schiedsrichter_ids: Sequence[Any]) -> list[Mapping[str, Any]]:
    """Run on `spiele`: the seasons of every fixture booked to one of these referees, as a season button lists them, the newest first."""

    return [
        {"$match": {"schiedsrichter.schiedsrichter_id": {"$in": list(schiedsrichter_ids)}}},
        {"$group": {"_id": "$saison_id"}},
        {
            "$lookup": {
                "from": Collection.SAISONS,
                "localField": "_id",
                "foreignField": "_id",
                "pipeline": [{"$project": dict.fromkeys(SAISON_FRAME_FIELDS, 1)}],
                "as": "saison",
            }
        },
        {"$unwind": "$saison"},
        {"$replaceWith": "$saison"},
        {"$sort": dict(SAISON_FRAME_ORDER)},
    ]


# Where `build_self_spiele_pipeline` puts what it joins onto each fixture.
OWN_ROW_AS: Final = "spielbestaetigung"
OWN_ROW_JUNCTIONS_AS: Final = "junctions"
BERICHT_AS: Final = "spielbericht"


def build_self_spiele_pipeline(*, saison_id: str, schiedsrichter_ids: Sequence[Any]) -> list[Mapping[str, Any]]:
    """Run on `spiele`: the season's fixtures booked to one of these referees, each with what the referee's list judges it by.

    Each fixture through the name join with the fields a confirmation row is judged against; the newest row asking the booked referee about it,
    with both clubs' season rows its Ansetzung names; when its report was first sent; and its season's status.
    """

    return [
        *build_named_spiele_pipeline(
            {"saison_id": saison_id, "schiedsrichter.schiedsrichter_id": {"$in": list(schiedsrichter_ids)}},
            # The sides' exits too, which the name join folds in: a club out by the fixture's day takes the booking off it.
            projection={**JUDGED_SPIEL_FIELDS, "saison_id": 1, "team1.austritt.date": 1, "team2.austritt.date": 1},
        ),
        {
            "$lookup": {
                "from": Collection.SPIELBESTAETIGUNGEN,
                "let": {"saison_id": "$saison_id", "spiel_id": "$_id", "schiedsrichter_id": "$schiedsrichter.schiedsrichter_id"},
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$and": [
                                    {"$eq": ["$saison_id", "$$saison_id"]},
                                    {"$eq": ["$spiel_id", "$$spiel_id"]},
                                    {"$eq": ["$party.kind", "schiedsrichter"]},
                                    # The booked record's rows alone: a row of the address's other record asked about
                                    # a booking the fixture no longer holds.
                                    {"$eq": ["$party.schiedsrichter_id", "$$schiedsrichter_id"]},
                                ]
                            }
                        }
                    },
                    # The newest by `_id`, which the pass mints in order.
                    {"$sort": {"_id": -1}},
                    {"$limit": 1},
                    {"$project": dict(OWN_ROW_FIELDS)},
                    {
                        "$lookup": {
                            "from": Collection.SAISON_TEAMS,
                            "let": {"saison_id": "$saison_id", "team_ids": ["$ansetzung.team1_id", "$ansetzung.team2_id"]},
                            "pipeline": [
                                {"$match": {"$expr": {"$and": [{"$eq": ["$saison_id", "$$saison_id"]}, {"$in": ["$team_id", "$$team_ids"]}]}}},
                                {"$project": dict(JUDGED_JUNCTION_FIELDS)},
                            ],
                            "as": OWN_ROW_JUNCTIONS_AS,
                        }
                    },
                ],
                "as": OWN_ROW_AS,
            }
        },
        {
            "$lookup": {
                "from": Collection.SPIELBERICHTE,
                "localField": "_id",
                "foreignField": "spiel_id",
                "pipeline": [{"$project": {"_id": 0, "submitted_at": "$bericht.submitted_at"}}],
                "as": BERICHT_AS,
            }
        },
        SAISON_LOOKUP,
    ]


def entered_of(spielbestaetigung_raw: Mapping[str, Any]) -> bool:
    """Whether an administrator recorded this row's answer.

    An administrator's entry stores `by: {kind: "admin"}`.
    """

    return bool(((spielbestaetigung_raw.get("answer") or {}).get("by") or {}).get("kind") == "admin")


def own_reason_of(spielbestaetigung_raw: Mapping[str, Any]) -> str | None:
    """The reason on the referee's own decline alone: an administrator's entry on their row is the league's record, not theirs to read."""

    answer = spielbestaetigung_raw.get("answer") or {}

    return answer.get("reason") if (answer.get("by") or {}).get("kind") == "schiedsrichter" else None


def compose_self_spiel(spiel: Mapping[str, Any], *, now: datetime) -> FLSchiedsrichterSpiel:
    """One fixture of `build_self_spiele_pipeline`'s as the referee's list shows it: as it stands, never as a row asked about it."""

    row = next(iter(spiel[OWN_ROW_AS]), None)
    bericht = next(iter(spiel[BERICHT_AS]), None)
    # One row: a fixture's season always stands, and the read joins it by its id.
    [saison] = spiel[SAISON_AS]
    spielort = spiel.get("spielort")
    # A club out by the fixture's day ends the booking, as the pass's notice told the referee.
    officiates = not exit_ends_the_booking(spiel)
    # As the report's own read judges its form open.
    reportable = officiates and takes_a_bericht(spiel, now=now) and not season_has_ended(saison_status=saison["status"])
    submitted_at = None if bericht is None else bericht.get("submitted_at")

    def team_name(side: str) -> str | None:
        team = spiel.get(side)
        return team.get("name") if isinstance(team, Mapping) else None

    return FLSchiedsrichterSpiel(
        spiel_id=spiel["_id"],
        team1_name=team_name("team1"),
        team2_name=team_name("team2"),
        date=spiel.get("date"),
        time=spiel.get("time"),
        spielort=None
        if not isinstance(spielort, Mapping)
        else FLSpielortFieldPublic(spielort_id=spielort["spielort_id"], name=spielort["name"], maps_query=spielort["maps_query"]),
        sonderereignis=spiel.get("sonderereignis"),
        spielbestaetigung_id=None if row is None else row["_id"],
        state=None
        if row is None
        else schiedsrichter_state_of(
            spielbestaetigung_raw=row, ansetzung_state=AnsetzungState(spiel=spiel, junctions=row[OWN_ROW_JUNCTIONS_AS]), now=now
        ),
        reason=None if row is None else own_reason_of(row),
        entered=row is not None and entered_of(row),
        officiates=officiates,
        past=is_played(date=spiel.get("date"), time=spiel.get("time"), now=now),
        submitted_at=submitted_at,
        bericht_owed=owes_a_bericht(reportable=reportable, submitted_at=submitted_at, sonderereignis=spiel.get("sonderereignis")),
    )


def owes_a_bericht(*, reportable: bool, submitted_at: datetime | None, sonderereignis: str | None) -> bool:
    """Whether the referee owes the fixture's report: one it takes now and none sent, on a fixture that kept its slot.

    An abandoned one included, which used the ground and the referee: a no-show used neither, so its report stays open
    to write and nobody owes it.
    """

    return reportable and submitted_at is None and sonderereignis in SONDEREREIGNIS_KEEPING_ITS_SLOT


def is_open_work(spiel: FLSchiedsrichterSpiel) -> bool:
    """Whether the fixture waits on the referee: a booking to answer, or a report owed."""

    return spiel.state == "valid" or spiel.bericht_owed


def _by_day(spiel: FLSchiedsrichterSpiel) -> tuple[bool, str, str, str]:
    # An undated fixture after every dated one; the id last, so no two rows tie.
    return spiel.date is None, spiel.date or "", spiel.time or "", str(spiel.spiel_id)


def order_self_spiele(spiele: Sequence[FLSchiedsrichterSpiel]) -> list[FLSchiedsrichterSpiel]:
    """Open work first, then the fixtures to come, each by its day; then the days gone by, the latest first."""

    rest = [spiel for spiel in spiele if not is_open_work(spiel)]

    return [
        *sorted(filter(is_open_work, spiele), key=_by_day),
        *sorted((spiel for spiel in rest if not spiel.past), key=_by_day),
        *sorted((spiel for spiel in rest if spiel.past), key=_by_day, reverse=True),
    ]
