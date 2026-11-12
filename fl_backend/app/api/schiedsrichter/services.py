from collections.abc import Mapping, Sequence
from datetime import date, datetime, time, timedelta
from http import HTTPStatus
from typing import Any, Final

from app.api.bewerbungen.services import days_after, season_has_ended
from app.api.saisons.schemas import SAISON_FRAME_FIELDS, SAISON_FRAME_ORDER
from app.api.saisons.services import SAISON_AS, SAISON_LOOKUP
from app.api.schiedsrichter.schemas import FLSchiedsrichterConfirmationState, FLSchiedsrichterSpiel
from app.api.spielberichte.services import takes_a_bericht
from app.api.spielbestaetigungen.crud import JUDGED_SPIEL_FIELDS, JUDGED_VEREIN_FIELDS, OWN_ROW_FIELDS
from app.api.spielbestaetigungen.services import AnsetzungState, schiedsrichter_state_of
from app.api.spiele.schemas import FLSpielortFieldPublic, unplayed_filter
from app.api.spiele.services import build_named_spiele_pipeline
from app.api.teams.services import is_played
from app.core import clock
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import WriteRefusal
from app.shared.age import whole_years_between
from app.shared.einwilligung import is_confirmed
from app.shared.einwilligung_evidence import TextVersions, compose_initial
from app.shared.folding import league_address, sign_in_identifier
from app.shared.schemas.bounds import (
    BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
    SCHIEDSRICHTER_CONFIRMATION_DEADLINE_DAYS,
    SCHIEDSRICHTER_MIN_AGE_YEARS,
)


def build_assignment_filter(schiedsrichter_id: Any) -> Mapping[str, Any]:
    """Every fixture naming this referee, played or not — the set the erasure partitions."""

    return {"schiedsrichter.schiedsrichter_id": schiedsrichter_id}


def build_unplayed_assignment_filter(schiedsrichter_id: Any) -> Mapping[str, Any]:
    """Every fixture this referee holds that is still to be played, which is what the retirement's refusal judges.

    Composed from `build_assignment_filter` rather than spelled again, so the path cannot be
    narrowed on one seam alone.
    """

    return {**build_assignment_filter(schiedsrichter_id), **unplayed_filter()}


def find_referee_name_refusal(*, taken: bool) -> WriteRefusal | None:
    """`duplicate_key` on the name: another referee, a retired one included, holds it.

    Takes the answer rather than the lookup, so the caller's read runs in the caller's transaction. The unique index still
    answers a race between two writes, as `duplicate_key` with no field.
    """

    if not taken:
        return None

    return WriteRefusal(
        error_code=Code.DUPLICATE_KEY,
        status=HTTPStatus.CONFLICT,
        fields=(("name",),),
    )


def find_referee_retire_refusal(*, upcoming_spiel_nrs: Sequence[int]) -> WriteRefusal | None:
    """Why retiring this referee must be refused, or `None`.

    `upcoming_spiel_nrs` is `unplayed_spiel_nrs`'s definition of "still to come", named with its count on the path's
    id as the venue's refusal names it.
    """

    if not upcoming_spiel_nrs:
        return None

    return WriteRefusal(
        error_code=Code.SCHIEDSRICHTER_STILL_ASSIGNED,
        status=HTTPStatus.CONFLICT,
        fields=(("schiedsrichter_id",),),
        location="path",
        bounds={"spiel_nrs": list(upcoming_spiel_nrs), "count": len(upcoming_spiel_nrs)},
    )


# --- The CONFIRMATION LINK. Every predicate below reads a missing `confirmation` block as "nothing
# was ever mailed": a retired referee whose corrected address was stored unmailed holds none.


# The record's confirmation block, under which the hand-out stores the hashes it mints.
CONFIRMATION_FIELD: Final = "confirmation"

# Where the hand-out stores the hashes of the links it mints, and the address it mints them for.
TOKEN_HASHES_PATH: Final = f"{CONFIRMATION_FIELD}.token_hashes"
# The day the person objected through their link. On the block, so a mint replacing it asks them afresh: only a save
# moving the address mints over an answer, the objection then having come from a mailbox the entry no longer names.
DECLINED_AT_PATH: Final = f"{CONFIRMATION_FIELD}.declined_at"
ADDRESS_PATH: Final = "kontakt.email"

EINWILLIGUNG_FIELD: Final = "einwilligung"

# The instant the hourly pass erases an unanswered or declined entry (`app/api/schiedsrichter/system_router.py ::
# sweep_schiedsrichter`), its bookings and confirmation rows with it, which a TTL index deleting the row could not do. On the
# record rather than inside the block: a retired referee's corrected address drops the block, and the entry its person
# never confirmed still goes on the clock its last link started.
ERASE_AT_FIELD: Final = "erase_at"


def build_erasure_due_filter(*, now: datetime) -> Mapping[str, Any]:
    """Every entry whose deletion date has passed: a confirmed entry holds none, so it is never due."""

    return {ERASE_AT_FIELD: {"$lte": now}}


def confirmation_deadline_from(*, today: str) -> str:
    """The day the link stops working, counted from the mint -- a re-send restarts it."""

    return days_after(day=today, days=SCHIEDSRICHTER_CONFIRMATION_DEADLINE_DAYS)


def erase_at_from(*, deadline: str) -> datetime:
    """The German midnight closing the deadline's day: the link still answers on that day, so the entry outlives it."""

    return datetime.combine(date.fromisoformat(deadline) + timedelta(days=1), time(), tzinfo=clock.GERMANY)


def compose_confirmation(*, today: str) -> dict[str, Any]:
    """The bookkeeping every owed link writes: no hash until the hand-out mints one, owed today."""

    return {"token_hashes": [], "sent_at": today, "deadline": confirmation_deadline_from(today=today)}


def compose_mint_update(*, today: str) -> dict[str, Any]:
    """The WHOLE block, so every link the referee was sent before stops working at this write, and the clock it restarts."""

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
    """The ONE `$set` a confirmation is.

    Never two writes: between them the row would hold a birthdate nobody had yet consented to the
    league keeping.
    """

    # Born whole rather than moved: the stamp refusal admits only a row whose stored block no answer
    # of this referee's stands on, and a dotted `$set` under a null block aborts the transaction.
    record = compose_initial(block=compose_einwilligung(scope=scope, media=media, today=today), at=at, text_versions=text_versions)

    # The clock goes with the answer: a confirmed entry stays until its person or the league ends it.
    return {"$set": {"birth_date": birth_date, EINWILLIGUNG_FIELD: record}, "$unset": {ERASE_AT_FIELD: ""}}


def compose_decline_update(*, today: str) -> Mapping[str, Any]:
    """The objection's one write: its day on the block, the entry left to go on the clock its link started."""

    return {"$set": {DECLINED_AT_PATH: today}}


def build_token_filter(*, token_hash: str) -> Mapping[str, Any]:
    """The hash alone finds the referee. No `inactive_since` term: a person retired after the mint still owns the answer they give."""

    return {TOKEN_HASHES_PATH: token_hash}


def link_is_over(*, deadline: str, today: str) -> bool:
    """Whether the deadline has passed: its own day still takes the answer."""

    return deadline < today


def deadline_passed(block: Mapping[str, Any] | None, *, today: str) -> bool:
    """Whether the link a referee holds has passed its deadline; false where they hold none."""

    return block is not None and link_is_over(deadline=block["deadline"], today=today)


def is_declined(confirmation: Any) -> bool:
    """Whether the person objected through the link their block holds."""

    return isinstance(confirmation, Mapping) and confirmation.get("declined_at") is not None


def has_answered(*, einwilligung: Any, confirmation: Any) -> bool:
    """Whether the person answered their link either way, which spends it: a consent's stamp or an objection's day."""

    return is_confirmed(einwilligung=einwilligung) or is_declined(confirmation)


def state_of(*, einwilligung: Any, confirmation: Mapping[str, Any], today: str) -> FLSchiedsrichterConfirmationState:
    """What a reopened link shows: an answer over the deadline.

    A person who answered on the last valid day is shown that they did.
    """

    if is_confirmed(einwilligung=einwilligung):
        return "confirmed"

    if is_declined(confirmation):
        return "declined"

    return "expired" if link_is_over(deadline=confirmation["deadline"], today=today) else "valid"


def answered_at_of(*, state: FLSchiedsrichterConfirmationState, einwilligung: Any, confirmation: Mapping[str, Any]) -> str | None:
    """The day of the answer `state` shows, the consent's or the objection's; `None` where it shows none."""

    if state == "confirmed":
        return str(einwilligung["confirmed_at"])

    if state == "declined":
        return str(confirmation["declined_at"])

    return None


def find_unknown_token_refusal(*, found: bool) -> WriteRefusal | None:
    """Why this token opens nothing, or `None`.

    ONE answer for unknown, replaced by a later mint, and deleted with the referee: nothing
    distinguishes them from a stranger's guess, and naming which would say more than the guess knew.
    """

    if found:
        return None

    return WriteRefusal(
        error_code=Code.LINK_INVALID,
        status=HTTPStatus.NOT_FOUND,
    )


def find_expired_token_refusal(*, deadline: str, today: str) -> WriteRefusal | None:
    """Why this link is over, or `None`."""

    if not link_is_over(deadline=deadline, today=today):
        return None

    return WriteRefusal(
        error_code=Code.LINK_EXPIRED,
        status=HTTPStatus.GONE,
    )


def find_already_answered_refusal(*, einwilligung: Any, confirmation: Any) -> WriteRefusal | None:
    """Why this entry takes no second answer, or `None`. The single use: a stamp or an objection is what spends the link."""

    # The answer and never a nulled hash: the hash stays live so a second press is told why.
    if not has_answered(einwilligung=einwilligung, confirmation=confirmation):
        return None

    return WriteRefusal(
        error_code=Code.CONFIRMATION_EXISTS,
        status=HTTPStatus.CONFLICT,
    )


def find_age_refusal(*, birth_date: str, today: str) -> WriteRefusal | None:
    """Why the typed date is refused, or `None`. Judged BEFORE any write, so a mistyped year spends nothing.

    The bounds go with the refusal, so the field's message names the range the write judges.
    """

    if SCHIEDSRICHTER_MIN_AGE_YEARS <= whole_years_between(born=birth_date, today=today) <= BEWERBUNG_KONTAKT_MAX_AGE_YEARS:
        return None

    return WriteRefusal(
        error_code=Code.CONFIRMATION_AGE,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        fields=(("birth_date",),),
        bounds={"min": SCHIEDSRICHTER_MIN_AGE_YEARS, "max": BEWERBUNG_KONTAKT_MAX_AGE_YEARS},
    )


def find_retired_refusal(*, inactive_since: Any) -> WriteRefusal | None:
    """Why a retired referee takes no fresh link, or `None`.

    A refusal to COLLECT and never a retire-first gate: a row taking no new booking would be asked
    to consent to a role nobody can give them.
    """

    if inactive_since is None:
        return None

    return WriteRefusal(
        error_code=Code.SCHIEDSRICHTER_RETIRED,
        status=HTTPStatus.CONFLICT,
    )


def find_missing_address_refusal(*, email: str) -> WriteRefusal | None:
    """Why there is nobody to send to, or `None`: a stored address the fold cannot canonicalise, such as a placeholder.

    Refused here and not at the calling surface alone: a mint that wrote `sent_at` for a row
    with no address would record a message that was never composed.
    """

    try:
        league_address(email)
    except ValueError:
        return WriteRefusal(
            error_code=Code.SCHIEDSRICHTER_NO_ADDRESS,
            status=HTTPStatus.CONFLICT,
        )

    return None


def _address_moves(*, stored: Mapping[str, Any], payload_email: str) -> bool:
    # Both the fold every payload stores, so one string is one mailbox.
    return payload_email != stored["kontakt"]["email"]


def save_moves_the_link(*, stored: Mapping[str, Any], payload_email: str) -> bool:
    """Whether a save retires the referee's link or mints a fresh one: an unanswered referee's address moving to another mailbox."""

    # A CONFIRMED referee's address is never the save's (`find_confirmed_address_refusal`).
    if is_confirmed(einwilligung=stored.get(EINWILLIGUNG_FIELD)):
        return False

    return _address_moves(stored=stored, payload_email=payload_email)


def find_confirmed_address_refusal(*, stored: Mapping[str, Any], payload_email: str) -> WriteRefusal | None:
    """`schiedsrichter_address_only_per_change`: a save moving a CONFIRMED referee's address, which keys their sign-in.

    Only an address change moves it. Refused whole: landing the rest, an editor stale on the address would lose its other fields unseen.
    """

    if not is_confirmed(einwilligung=stored.get(EINWILLIGUNG_FIELD)) or not _address_moves(stored=stored, payload_email=payload_email):
        return None

    return WriteRefusal(
        error_code=Code.SCHIEDSRICHTER_ADDRESS_ONLY_PER_CHANGE,
        status=HTTPStatus.CONFLICT,
    )


def compose_correction_update(
    *, stored: Mapping[str, Any], payload: Mapping[str, Any], payload_email: str, today: str
) -> tuple[dict[str, Any], bool]:
    """The save's update, and whether it owes a fresh consent link.

    A RETIRED unconfirmed referee's new address is stored and mailed nothing, and their old link
    goes, its mailbox replaced; the reactivation is what asks them.
    """

    if not save_moves_the_link(stored=stored, payload_email=payload_email):
        return {"$set": dict(payload)}, False

    if stored.get("inactive_since") is not None:
        return {"$set": dict(payload), "$unset": {CONFIRMATION_FIELD: ""}}, False

    # An UNCONFIRMED referee's old link went to a mailbox nobody reads, and leaving it live is a
    # credential in the wrong inbox.
    return {"$set": {**payload, **compose_mint_update(today=today)}}, True


def owes_reactivation_mint(*, stored: Mapping[str, Any]) -> bool:
    """Whether bringing this referee back mints them a link: retired, unanswered, and holding an address a link can go to.

    A row with no such address comes back unasked; entering one is the save that mints. A person who objected is
    asked nothing again.
    """

    return (
        stored.get("inactive_since") is not None
        and not has_answered(einwilligung=stored.get(EINWILLIGUNG_FIELD), confirmation=stored.get(CONFIRMATION_FIELD))
        and find_missing_address_refusal(email=stored["kontakt"]["email"]) is None
    )


# An INCLUSION and never an exclusion: a base-tier caller holds the whole credential, so the rest
# of the row is what must not reach them.
CONFIRMATION_VIEW_FIELDS: Mapping[str, int] = {
    f"{EINWILLIGUNG_FIELD}.confirmed_at": 1,
    f"{CONFIRMATION_FIELD}.deadline": 1,
    DECLINED_AT_PATH: 1,
    # Suppressed here alone: this endpoint stores nothing, so it needs no key to patch on.
    "_id": 0,
}

# The answer takes its wording from the payload rather than the row.
CONFIRMATION_ANSWER_FIELDS: Mapping[str, int] = {
    f"{EINWILLIGUNG_FIELD}.confirmed_at": 1,
    f"{CONFIRMATION_FIELD}.deadline": 1,
    DECLINED_AT_PATH: 1,
}

# What the re-send and the reactivation judge, and the address they mail.
INVITE_FIELDS: Mapping[str, int] = {
    "inactive_since": 1,
    "kontakt.email": 1,
    f"{EINWILLIGUNG_FIELD}.confirmed_at": 1,
    DECLINED_AT_PATH: 1,
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
OWN_ROW_VEREINE_AS: Final = "vereine"
BERICHT_AS: Final = "spielbericht"


def build_self_spiele_pipeline(*, saison_id: str, schiedsrichter_ids: Sequence[Any]) -> list[Mapping[str, Any]]:
    """Run on `spiele`: the season's fixtures booked to one of these referees, each with what the referee's list judges it by.

    Each fixture through the name join with the fields a confirmation row is judged against
    (`app/api/spielbestaetigungen/crud.py :: JUDGED_SPIEL_FIELDS`); the newest row asking the booked referee about it,
    with both clubs' season rows its Ansetzung names; when its report was first sent; and its season's status.
    """

    return [
        *build_named_spiele_pipeline(
            {"saison_id": saison_id, "schiedsrichter.schiedsrichter_id": {"$in": list(schiedsrichter_ids)}},
            projection={**JUDGED_SPIEL_FIELDS, "saison_id": 1},
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
                                {"$project": dict(JUDGED_VEREIN_FIELDS)},
                            ],
                            "as": OWN_ROW_VEREINE_AS,
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

    `app/api/spielbestaetigungen/services.py :: compose_enter_update` stores theirs as `by: {kind: "admin"}`.
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
        else FLSpielortFieldPublic(spielort_id=spielort["spielort_id"], name=spielort["name"], maps_link=spielort["maps_link"]),
        spielbestaetigung_id=None if row is None else row["_id"],
        state=None
        if row is None
        else schiedsrichter_state_of(
            spielbestaetigung_raw=row, ansetzung_state=AnsetzungState(spiel=spiel, vereine=row[OWN_ROW_VEREINE_AS]), now=now
        ),
        reason=None if row is None else own_reason_of(row),
        entered=row is not None and entered_of(row),
        past=is_played(date=spiel.get("date"), time=spiel.get("time"), now=now),
        # As the report's own read judges its form open (`app/api/spielberichte/services.py :: kader_is_open`).
        reportable=takes_a_bericht(spiel, now=now) and not season_has_ended(saison_status=saison["status"]),
        submitted_at=None if bericht is None else bericht.get("submitted_at"),
    )


def is_open_work(spiel: FLSchiedsrichterSpiel) -> bool:
    """Whether the fixture waits on the referee: a booking to answer, or a report owed."""

    return spiel.state == "valid" or (spiel.reportable and spiel.submitted_at is None)


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
