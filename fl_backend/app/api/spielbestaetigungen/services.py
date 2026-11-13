import hashlib
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from http import HTTPStatus
from typing import Any, Final, Literal, NamedTuple

from app.api.bewerbungen.services import days_after
from app.api.invitations.services import confirmed_recipients
from app.api.outbox.schemas import (
    FLAustrittNoticeData,
    FLOutboxClub,
    FLOutboxData,
    FLOutboxReference,
    FLSpielEinteilungLiftedData,
    FLSpielMailAnsetzung,
    FLSpielMailAppointment,
    FLSpielMailEntry,
    FLSpielMovedData,
    FLSpielNoticeData,
    FLSpielNoticeEvent,
    FLSpielVorschlagDiscardedData,
)
from app.api.outbox.services import OwedMail
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAnswerKind,
    FLSpielbestaetigungAppointment,
    FLSpielbestaetigungClosedReason,
    FLSpielbestaetigungSchiedsrichterState,
    FLSpielbestaetigungState,
    FLSpielbestaetigungTeamState,
    FLSpielbestaetigungViewAnsetzung,
)
from app.api.spiele.schemas import (
    SONDEREREIGNIS_CALLING_OFF_BEFORE_ITS_DAY,
    FLPatchSpielDataPayload,
    FLSpiel,
    FLSpielElfmeterschiessenPayload,
    FLSpielortFieldPayload,
    FLSpielortFieldPublic,
    FLSpielSchiedsrichterFieldPayload,
    FLSpielTeamFieldPayload,
)
from app.api.teams.services import has_taken_place, is_played
from app.core import clock
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import Twins, WriteRefusal
from app.shared.schemas.bounds import (
    AUFSTELLUNG_REMINDER_DAYS,
    SPIEL_CONFIRMATION_DEADLINE_DAYS,
    SPIEL_REMINDER_DAYS,
    SPIEL_REQUEST_LEAD_TIME_DAYS,
)
from app.shared.schemas.literals import FLKontaktRolle, FLSpielSide

# Each stored `ansetzung` key and its fixture path: the one list the digest, the snapshot and the public
# verdict's `$lookup` read, a key one lacks giving two answers to which Ansetzung a row is about.
ANSETZUNG_QUELLEN: Final[Mapping[str, str]] = {
    "date": "date",
    "time": "time",
    "spielort_id": "spielort.spielort_id",
    "team1_id": "team1.team_id",
    "team2_id": "team2.team_id",
}


def _read_path(document: Mapping[str, Any], path: str) -> Any:
    value: Any = document
    for key in path.split("."):
        value = value.get(key) if isinstance(value, Mapping) else None

    return value


def _ansetzung_values(spiel: Mapping[str, Any]) -> dict[str, Any]:
    return {key: _read_path(spiel, path) for key, path in ANSETZUNG_QUELLEN.items()}


def _digest(values: Mapping[str, Any]) -> str:
    # A missing value is the empty string; no input's own alphabet holds the separator.
    canonical = "|".join("" if values[key] is None else str(values[key]) for key in ANSETZUNG_QUELLEN)

    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def ansetzung_digest_of(spiel: Mapping[str, Any]) -> str:
    """The digest of a raw fixture's Ansetzung: `date`, `time`, `spielort.spielort_id`, `team1.team_id`, `team2.team_id`.

    The ground on purpose: a confirmation binds it too. A sixth input changes every stored row's meaning.
    """

    return _digest(_ansetzung_values(spiel))


def compose_ansetzung(spiel: Mapping[str, Any]) -> dict[str, Any]:
    """The stored `ansetzung` of a row minted for this fixture: the digest's inputs and the digest, from one read."""

    values = _ansetzung_values(spiel)

    return {**values, "digest": _digest(values)}


def build_answerable_filter() -> dict[str, Any]:
    """A row the answer may write: neither answered nor closed, the reach of `uniq_spielbestaetigung_open`.

    Repeated on the write after the read's judgement; a rival answer committing between them conflicts, and the retry
    judges.
    """

    return {"answer": None, "closed": None}


def build_closable_filter() -> dict[str, Any]:
    """A row the sweep's close reaches: not yet closed, answered or not.

    Never `build_answerable_filter`: an agreement a move overtook would keep no stamp saying why it
    stopped applying.
    """

    return {"closed": None}


# --- A party's answer and what its pages show of a row.


# A row closed, or due to close, for one of these is about an Ansetzung the fixture has left, which the
# page tells apart from a deadline that ran out.
REASONS_INVALID: Final = frozenset({"ansetzung_changed", "schiedsrichter_switched"})


# What a club's answer judges of its row: its fixture, party and Ansetzung, the deadline, and whether it is answered or
# closed. An inclusion, so no reason or proposal is read that the judgement does not need.
TEAM_ANSWER_FIELDS: Mapping[str, int] = {
    "saison_id": 1,
    "spiel_id": 1,
    "party": 1,
    "ansetzung": 1,
    "deadline": 1,
    "answer.kind": 1,
    "closed": 1,
}


def decision_of(*, spiel: Mapping[str, Any], austritte: Iterable[str], tag: Any) -> FLSpielbestaetigungClosedReason | None:
    """Why a fixture takes no confirmation whatever its Ansetzung: decided, called off, or a club out by `tag`.

    One rule for the answer's refusal and the pass's close, so no answer is taken on what the next pass shuts.
    """

    if has_taken_place(spiel):
        return "spiel_decided"

    # Every other event leaves no record: a called-off fixture is asked afresh once reinstated.
    if spiel.get("sonderereignis") is not None:
        return "cancelled"

    if tag is not None and any(austritt <= tag for austritt in austritte):
        return "austritt"

    return None


@dataclass(frozen=True)
class AnsetzungState:
    """What an answer is judged against and does not write: the fixture as it stands, and both clubs' season rows."""

    spiel: Mapping[str, Any]
    vereine: Sequence[Mapping[str, Any]]


def _reason_now(
    *, spielbestaetigung_raw: Mapping[str, Any], ansetzung_state: AnsetzungState, now: datetime
) -> FLSpielbestaetigungClosedReason | None:
    """Why the pass's next close would shut this row, read off its own judge: a page never shows or refuses otherwise than it records."""

    austritte = {
        row.get("team_id"): str(date) for row in ansetzung_state.vereine if (date := (row.get("austritt") or {}).get("date")) is not None
    }

    return reason_to_end(row=spielbestaetigung_raw, spiel=ansetzung_state.spiel, austritte=austritte, now=now)


def _past_deadline(*, spielbestaetigung_raw: Mapping[str, Any], now: datetime) -> bool:
    # Never a referee's row: the Einteilung names no deadline, so a referee answers until the kick-off, which
    # `reason_to_close` judges.
    if spielbestaetigung_raw["party"]["kind"] == "schiedsrichter":
        return False

    # An answer is taken on its deadline's own day.
    return clock.german_day(now) > str(spielbestaetigung_raw["deadline"])


def reason_of(
    *, spielbestaetigung_raw: Mapping[str, Any], ansetzung_state: AnsetzungState, now: datetime
) -> FLSpielbestaetigungClosedReason | None:
    """Why a row stopped applying: closed, by the reason stored; open, by the one the pass's next close would store."""

    closed = spielbestaetigung_raw.get("closed")

    return (
        closed["reason"]
        if isinstance(closed, Mapping)
        else _reason_now(spielbestaetigung_raw=spielbestaetigung_raw, ansetzung_state=ansetzung_state, now=now)
    )


def due_by_of(spielbestaetigung_raw: Mapping[str, Any]) -> str:
    """The day a party's answer is due by: a club's deadline, and a referee's slot, the Einteilung naming no deadline."""

    if spielbestaetigung_raw["party"]["kind"] == "schiedsrichter":
        return str(spielbestaetigung_raw["ansetzung"]["date"])

    return str(spielbestaetigung_raw["deadline"])


def lapsed_on(*, spielbestaetigung_raw: Mapping[str, Any], reason: FLSpielbestaetigungClosedReason | None, now: datetime) -> str | None:
    """The day an unanswered row's answer lapsed, its `due_by_of`, or `None`; `reason` is `reason_of`'s.

    Only a lapse dates a row: its slot kicked off, or a club's deadline went by with nothing else ending it. A row an
    exit, a decision, a call-off or a move ended never lapsed, whatever its deadline says.
    """

    if spielbestaetigung_raw.get("answer") is not None:
        return None

    if reason == "spiel_past" or (reason is None and _past_deadline(spielbestaetigung_raw=spielbestaetigung_raw, now=now)):
        return due_by_of(spielbestaetigung_raw)

    return None


def state_of(
    *,
    spielbestaetigung_raw: Mapping[str, Any],
    ansetzung_state: AnsetzungState,
    now: datetime,
    vorschlag_open: FLSpielbestaetigungAppointment | None,
) -> FLSpielbestaetigungState:
    """What a party's page shows of a row, the first state matching winning: a row already answered shows its answer, never a refusal.

    Asked of a club's unclosed row, of a referee's newest, and by the match editor of every row: a closed row reads by
    the reason it was closed for, so a discarded decline reads as that decline, but an agreement only while its
    Ansetzung still stands.
    """

    answer = spielbestaetigung_raw.get("answer")
    reason = reason_of(spielbestaetigung_raw=spielbestaetigung_raw, ansetzung_state=ansetzung_state, now=now)

    # Ahead of the answer: an answer about an Ansetzung the fixture has left settles nothing, and the move's notice
    # told every seat the date is off, so no page may tell a seat nothing is owed.
    if reason in REASONS_INVALID:
        return "invalid"

    # Ahead of the answer too: an agreement to a fixture called off since would send its party to the ground.
    if reason == "cancelled":
        return "cancelled"

    if isinstance(answer, Mapping) and answer["kind"] == "declined":
        return "declined"

    # An agreement binds the Ansetzung it answered, as the fixture's confirmation reads it: a row closed before the
    # fixture moved agrees to a day nobody asked about, and the pass asks again only once the new day is in its window.
    if isinstance(answer, Mapping):
        return "agreed" if spielbestaetigung_raw["ansetzung"]["digest"] == ansetzung_digest_of(ansetzung_state.spiel) else "invalid"

    if reason is not None or _past_deadline(spielbestaetigung_raw=spielbestaetigung_raw, now=now):
        return "expired"

    return "valid" if vorschlag_open is None else "vorschlag"


def first_press_refusal() -> WriteRefusal:
    """`ansetzung_answered`, built here alone: by the answered row's judgement and by the answer whose filtered write matched nothing."""

    return WriteRefusal(
        error_code=Code.ANSETZUNG_ANSWERED,
        status=HTTPStatus.GONE,
    )


def ansetzung_left_refusal() -> WriteRefusal:
    """`ansetzung_changed`, built here alone: by the answered row's judgement and by a referee's decline whose fixture write matched nothing."""

    return WriteRefusal(
        error_code=Code.ANSETZUNG_CHANGED,
        status=HTTPStatus.GONE,
    )


def team_state_of(
    *,
    spielbestaetigung_raw: Mapping[str, Any],
    ansetzung_state: AnsetzungState,
    now: datetime,
    vorschlag_open: FLSpielbestaetigungAppointment | None,
) -> FLSpielbestaetigungTeamState | None:
    """What a team's own pages show of its unclosed row about the fixture as it stands: `state_of`'s state, or `None`.

    `None` where the row asks the team nothing: about an Ansetzung left, or a fixture called off or decided.
    """

    # Ahead of the pass's close, which takes the row off these pages: a lapsed row would read that the league decides.
    if _reason_now(spielbestaetigung_raw=spielbestaetigung_raw, ansetzung_state=ansetzung_state, now=now) == "spiel_decided":
        return None

    match state_of(spielbestaetigung_raw=spielbestaetigung_raw, ansetzung_state=ansetzung_state, now=now, vorschlag_open=vorschlag_open):
        case "valid" | "vorschlag" | "expired" | "agreed" | "declined" as state:
            return state
        case _:
            return None


def schiedsrichter_state_of(
    *, spielbestaetigung_raw: Mapping[str, Any], ansetzung_state: AnsetzungState, now: datetime
) -> FLSpielbestaetigungSchiedsrichterState:
    """What a referee's own list shows of their row about the fixture as it stands: `state_of`'s state, which no proposal reaches."""

    state = state_of(spielbestaetigung_raw=spielbestaetigung_raw, ansetzung_state=ansetzung_state, now=now, vorschlag_open=None)
    assert state != "vorschlag"

    return state


def find_unanswerable_refusal(
    *, spielbestaetigung_raw: Mapping[str, Any], ansetzung_state: AnsetzungState, now: datetime
) -> WriteRefusal | None:
    """Why this row takes no answer now, or `None`: answered, closed unanswered, what the close would shut it for, then the deadline.

    An answered row whose Ansetzung moved answers `ansetzung_answered` and reads `invalid`: the page re-reads the view on
    `ansetzung_answered`.
    """

    if spielbestaetigung_raw.get("answer") is not None:
        return first_press_refusal()

    if spielbestaetigung_raw.get("closed") is not None:
        return WriteRefusal(
            error_code=Code.ANSETZUNG_CLOSED,
            status=HTTPStatus.GONE,
        )

    reason = _reason_now(spielbestaetigung_raw=spielbestaetigung_raw, ansetzung_state=ansetzung_state, now=now)

    if reason in REASONS_INVALID:
        return ansetzung_left_refusal()

    # A kick-off gone by is a deadline gone by too, the deadline lying before it: late rather than decided.
    if reason is not None and reason != "spiel_past":
        return WriteRefusal(
            error_code=Code.ANSETZUNG_DECIDED,
            status=HTTPStatus.GONE,
        )

    if reason is not None:
        return WriteRefusal(
            error_code=Code.ANSETZUNG_DEADLINE_PAST,
            status=HTTPStatus.GONE,
        )

    if _past_deadline(spielbestaetigung_raw=spielbestaetigung_raw, now=now):
        return WriteRefusal(
            error_code=Code.ANSETZUNG_DEADLINE_PAST,
            status=HTTPStatus.GONE,
        )

    return None


def find_vorschlag_past_refusal(*, vorschlag: FLSpielbestaetigungAppointment, today: str) -> WriteRefusal | None:
    """`ansetzung_vorschlag_past`: a proposal names a day still to come or today."""

    if vorschlag.date >= today:
        return None

    return WriteRefusal(
        error_code=Code.ANSETZUNG_VORSCHLAG_PAST,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        # The date box the form holds the proposal in, so it is marked where the reader typed the day.
        fields=(("vorschlag", "date"),),
    )


def find_vorschlag_unchanged_refusal(*, vorschlag: FLSpielbestaetigungAppointment, spiel: FLSpiel) -> WriteRefusal | None:
    """`ansetzung_vorschlag_unchanged`: a proposal names the day and hour the fixture already holds.

    Adopted, it would save the slot unchanged, leaving the row about it open and the proposal pressable for ever.
    """

    if (vorschlag.date, vorschlag.time) != (spiel.date, spiel.time):
        return None

    return WriteRefusal(
        error_code=Code.ANSETZUNG_VORSCHLAG_UNCHANGED,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        fields=(("vorschlag", "date"), ("vorschlag", "time")),
    )


# What the adoption answers under a 409 twin: each judges the stored proposal or the stored fixture, which a payload
# write judges as its body. A code the catalogue words by its path gets a twin per path, the adoption naming none.
ADOPTION_TWINS: Twins = {
    Code.ANSETZUNG_VORSCHLAG_PAST: Code.ANSETZUNG_VORSCHLAG_PAST_AS_STORED,
    Code.SPIEL_DOUBLE_BOOKED: {
        "spielort": Code.SPIEL_DOUBLE_BOOKED_SPIELORT_AS_STORED,
        "schiedsrichter": Code.SPIEL_DOUBLE_BOOKED_SCHIEDSRICHTER_AS_STORED,
    },
    Code.ELIGIBILITY_DISQUALIFIED: {
        "team1": Code.ELIGIBILITY_DISQUALIFIED_TEAM1_AS_STORED,
        "team2": Code.ELIGIBILITY_DISQUALIFIED_TEAM2_AS_STORED,
    },
}


def judged_as_a_proposal(refusal: WriteRefusal | None) -> WriteRefusal | None:
    """A refusal of the proposal, naming no field: the paths it names are a body this request does not carry."""

    return None if refusal is None else replace(refusal, fields=())


def proposal_payload(stored: FLSpiel, vorschlag: FLSpielbestaetigungAppointment) -> FLPatchSpielDataPayload:
    """The stored fixture as the administrator's wholesale save would carry it on the proposed date and hour, everything else kept.

    So a proposal meets the very judges that save meets, references and event as they stand, and its adoption saves the
    fixture with nothing but the slot moved: the save writes every field of it, the note included.
    """

    return FLPatchSpielDataPayload(
        sonderereignis=stored.sonderereignis,
        team1=None if stored.team1 is None else FLSpielTeamFieldPayload(team_id=stored.team1.team_id, tore=stored.team1.tore),
        team2=None if stored.team2 is None else FLSpielTeamFieldPayload(team_id=stored.team2.team_id, tore=stored.team2.tore),
        team1_quelle=stored.team1_quelle,
        team2_quelle=stored.team2_quelle,
        elfmeterschiessen=None
        if stored.elfmeterschiessen is None
        else FLSpielElfmeterschiessenPayload(team1=stored.elfmeterschiessen.team1, team2=stored.elfmeterschiessen.team2),
        date=vorschlag.date,
        time=vorschlag.time,
        spielort=None
        if stored.spielort is None
        else FLSpielortFieldPayload(spielort_id=stored.spielort.spielort_id, mietpreis=stored.spielort.mietpreis),
        schiedsrichter=(
            None
            if stored.schiedsrichter is None
            else FLSpielSchiedsrichterFieldPayload(
                schiedsrichter_id=stored.schiedsrichter.schiedsrichter_id, payment=stored.schiedsrichter.payment
            )
        ),
        note=stored.note,
        version=stored.version,
    )


def side_of(spielbestaetigung_raw: Mapping[str, Any]) -> FLSpielSide:
    """Off the stored snapshot, so a side the fixture has since lost still names the reader's club."""

    team_id = (spielbestaetigung_raw.get("party") or {}).get("team_id")

    return "team1" if team_id == spielbestaetigung_raw["ansetzung"]["team1_id"] else "team2"


def view_ansetzung_of(spiel: Mapping[str, Any]) -> FLSpielbestaetigungViewAnsetzung:
    """The fixture's Ansetzung as it stands, as a page or a mail states it.

    Its names are the join's: the stored fixture holds none.
    """

    # Absent rather than null where a projection met a fixture without a ground.
    spielort = spiel.get("spielort")

    return FLSpielbestaetigungViewAnsetzung(
        team1_name=spiel["team1"]["name"],
        team2_name=spiel["team2"]["name"],
        date=spiel["date"],
        time=spiel["time"],
        spielort=None
        if not isinstance(spielort, Mapping)
        else FLSpielortFieldPublic(spielort_id=spielort["spielort_id"], name=spielort["name"], maps_link=spielort["maps_link"]),
    )


def vereinsnamen_of(*, spielbestaetigung_raw: Mapping[str, Any], ansetzung_state: AnsetzungState) -> tuple[str, str]:
    """The clubs a notice about a moved row names: each side as the fixture fields it now, a side it lost by its season row."""

    snapshot = spielbestaetigung_raw["ansetzung"]
    names = {row.get("team_id"): row.get("name") for row in ansetzung_state.vereine}

    def side_name(slot: str, snapshot_key: str) -> str:
        side = ansetzung_state.spiel.get(slot)
        return str(side["name"]) if isinstance(side, Mapping) else str(names.get(snapshot[snapshot_key]) or "")

    return side_name("team1", "team1_id"), side_name("team2", "team2_id")


def compose_answer_update(
    *,
    answer: FLSpielbestaetigungAnswerKind,
    seat: FLKontaktRolle,
    vorschlag: FLSpielbestaetigungAppointment | None,
    reason: str | None,
    today: str,
) -> dict[str, Any]:
    return {
        "$set": {
            "answer": {
                "kind": answer,
                "at": today,
                # The seat and never its holder: the erasure of whoever holds the seat clears the reason typed from it.
                "by": {"kind": "kontakt", "rolle": seat},
                "vorschlag": None if vorschlag is None else {"date": vorschlag.date, "time": vorschlag.time},
                "reason": reason,
            }
        }
    }


# --- The administrator's settle and discard. Each check judges the row read in-session and its write's filter
# says the same again; a party's answer committing between the two conflicts with the write, whose retry refuses.


def enter_refusal() -> WriteRefusal:
    """`ansetzung_not_enterable`, built here alone: by the check on the row read and by the settle whose filtered write matched nothing."""

    return WriteRefusal(
        error_code=Code.ANSETZUNG_NOT_ENTERABLE,
        status=HTTPStatus.CONFLICT,
    )


def find_enter_refusal(*, spielbestaetigung_raw: Mapping[str, Any], ansetzung_state: AnsetzungState, now: datetime) -> WriteRefusal | None:
    """The administrator answers only a row neither answered nor closed, nor due to be shut by the pass's next close.

    A deadline gone by refuses nothing: the triage queue lists such a row for the administrator to settle.
    """

    if (
        spielbestaetigung_raw.get("answer") is None
        and spielbestaetigung_raw.get("closed") is None
        and _reason_now(spielbestaetigung_raw=spielbestaetigung_raw, ansetzung_state=ansetzung_state, now=now) is None
    ):
        return None

    return enter_refusal()


def compose_enter_update(*, reason: str, today: str) -> dict[str, Any]:
    """A Zusage recorded for the party, naming nobody: no seat, so no seat holder's erasure ever reaches its reason."""

    return {"$set": {"answer": {"kind": "agreed", "at": today, "by": {"kind": "admin"}, "vorschlag": None, "reason": reason}}}


def build_discardable_filter() -> dict[str, Any]:
    """An open team decline carrying a proposal: the one row a discard closes, and the triage's `vorschlag_open`.

    Any other row closed `discarded` would silence its party for the Ansetzung.
    """

    return {"party.kind": "team", "answer.kind": "declined", "answer.vorschlag": {"$ne": None}, **build_closable_filter()}


def discard_refusal() -> WriteRefusal:
    """`ansetzung_not_discardable`, built here alone: by the check on the row read and by the discard whose filtered write matched nothing."""

    return WriteRefusal(
        error_code=Code.ANSETZUNG_NOT_DISCARDABLE,
        status=HTTPStatus.CONFLICT,
    )


def build_triage_rows_filter(*, saison_id: str, today: str) -> dict[str, Any]:
    """This season's rows putting their fixture in the administrator's queue, a club's or its referee's.

    A club's standing proposal, or any party's deadline passed unanswered, or due today and asked today or never:
    `asked_at` stands in for the mint day no row stores.
    """

    open = build_answerable_filter()

    return {
        "saison_id": saison_id,
        "$or": [
            build_discardable_filter(),
            {**open, "deadline": {"$lt": today}},
            {**open, "deadline": today, "asked_at": {"$in": [None, today]}},
        ],
    }


def holds_an_open_proposal(*, spielbestaetigung_raw: Mapping[str, Any], ansetzung_state: AnsetzungState, now: datetime) -> bool:
    """`build_discardable_filter` asked of the row read, on a row the pass's next close leaves open: what a discard and an adoption act on.

    The close's own judgement, so neither acts on a row a save has overtaken before the hourly pass shuts it: about an
    Ansetzung the fixture left, or on a fixture decided, called off, kicked off or fielding a club gone by its day.
    """

    party, answer = spielbestaetigung_raw.get("party") or {}, spielbestaetigung_raw.get("answer") or {}

    return (
        party.get("kind") == "team"
        and answer.get("kind") == "declined"
        and answer.get("vorschlag") is not None
        and spielbestaetigung_raw.get("closed") is None
        and _reason_now(spielbestaetigung_raw=spielbestaetigung_raw, ansetzung_state=ansetzung_state, now=now) is None
    )


def find_discard_refusal(*, spielbestaetigung_raw: Mapping[str, Any], ansetzung_state: AnsetzungState, now: datetime) -> WriteRefusal | None:
    """Why a discard of this row must be refused, or `None`."""

    if holds_an_open_proposal(spielbestaetigung_raw=spielbestaetigung_raw, ansetzung_state=ansetzung_state, now=now):
        return None

    return discard_refusal()


def find_adoption_refusal(*, spielbestaetigung_raw: Mapping[str, Any], ansetzung_state: AnsetzungState, now: datetime) -> WriteRefusal | None:
    """Why an adoption of this row must be refused, or `None`: the discard's condition, under the adoption's own code."""

    if holds_an_open_proposal(spielbestaetigung_raw=spielbestaetigung_raw, ansetzung_state=ansetzung_state, now=now):
        return None

    return WriteRefusal(error_code=Code.ANSETZUNG_NOT_ADOPTABLE, status=HTTPStatus.CONFLICT)


# --- A party's own answer, a referee's or a club's seat holder's, signed in rather than by a link.


# The close a referee's own decline writes in its transaction: outside `REASONS_INVALID`, so the row reads as
# their decline, and outside `REASONS_ANSWERING_THE_ANSETZUNG`, so a re-booking is asked afresh.
REASON_OWN_DECLINE: Final = "schiedsrichter_declined"


def foreign_row_refusal() -> WriteRefusal:
    """`ansetzung_foreign_row`: one answer for an id naming no row and a row naming somebody else, so no id is confirmed to exist."""

    return WriteRefusal(
        error_code=Code.ANSETZUNG_FOREIGN_ROW,
        status=HTTPStatus.FORBIDDEN,
    )


def find_foreign_row_refusal(*, spielbestaetigung_raw: Mapping[str, Any] | None, schiedsrichter_ids: Iterable[Any]) -> WriteRefusal | None:
    """`foreign_row_refusal` unless the row's party is one of these referee records."""

    party = (spielbestaetigung_raw or {}).get("party") or {}
    if party.get("kind") == "schiedsrichter" and party.get("schiedsrichter_id") in set(schiedsrichter_ids):
        return None

    return foreign_row_refusal()


def compose_schiedsrichter_answer_update(*, answer: FLSpielbestaetigungAnswerKind, reason: str | None, today: str) -> dict[str, Any]:
    """A decline closes its own row in the write emptying the referee's slot: left open, it would hold a re-booking of them unasked."""

    set_fields: dict[str, Any] = {
        # No seat: a referee answers as the person their record names, and their erasure finds the row by its party.
        "answer": {"kind": answer, "at": today, "by": {"kind": "schiedsrichter"}, "vorschlag": None, "reason": reason}
    }
    if answer == "declined":
        set_fields.update(compose_closing_update(reason=REASON_OWN_DECLINE)["$set"])

    return {"$set": set_fields}


# --- The pass: what its mint and its reminder write.


def deadline_of(*, date: str, today: str) -> str:
    """The deadline a row minted today is given: a fixture already inside the notice period is due today."""

    return max(today, days_after(day=date, days=-SPIEL_CONFIRMATION_DEADLINE_DAYS))


def last_request_day(*, today: str) -> str:
    """The latest fixture day a pass run today asks about: the request goes out once its deadline is the answer window away."""

    return days_after(day=today, days=SPIEL_CONFIRMATION_DEADLINE_DAYS + SPIEL_REQUEST_LEAD_TIME_DAYS)


# --- The line-up reminder, owed by the same pass: no line-up document exists to stamp, so the mail's own keys hold it to one.


def build_aufstellung_reminder_filter(*, saison_id: str, today: str) -> dict[str, Any]:
    """The season's fixtures whose kick-off the line-up reminder's window can hold: from today to `AUFSTELLUNG_REMINDER_DAYS` on.

    Each with a time, both sides and no decision; `aufstellung_reminder_owed` decides, this narrows the read.
    """

    return {
        "saison_id": saison_id,
        "date": {"$gte": today, "$lte": days_after(day=today, days=AUFSTELLUNG_REMINDER_DAYS)},
        "time": {"$ne": None},
        "team1": {"$ne": None},
        "team2": {"$ne": None},
        "ergebnis": None,
        "sonderereignis": None,
    }


def aufstellung_reminder_key(*, spiel_id: Any, team_id: Any, seat: str) -> str:
    """The key of a club's line-up reminder for a fixture to one seat's mailbox: any seat's stored is the club reminded.

    The outbox keeps a row a retention after its last state, far past the window, so every later pass meets it.
    """

    return f"aufstellung/{spiel_id}/{team_id}/{seat}"


def build_request_filter(*, saison_id: str, today: str) -> dict[str, Any]:
    """The season's fixtures the mint may ask about; `request_is_due` decides, this narrows the read."""

    return {
        "saison_id": saison_id,
        "date": {"$gt": today, "$lte": last_request_day(today=today)},
        "time": {"$ne": None},
        "spielort": {"$ne": None},
        "team1": {"$ne": None},
        "team2": {"$ne": None},
        "ergebnis": None,
        "sonderereignis": None,
    }


# A closing that settles the party's one answer about its Ansetzung rather than ending the question: a second answer
# needs a new digest, which only a move mints.
REASONS_ANSWERING_THE_ANSETZUNG: Final = frozenset({"discarded"})

# What ends a discard as it ends an agreement beside it: every reason of `reason_to_close` but a move, which leaves the
# discard its club's answer to the Ansetzung left, and a referee change, never a club's.
REASONS_ENDING_AN_ANSWER: Final = frozenset({"austritt", "spiel_decided", "cancelled", "spiel_past"})


def build_holding_filter() -> dict[str, Any]:
    """A row holding its party's question about its Ansetzung: unclosed, or closed as answered.

    Every other closing ends the question, so a fixture reinstated or moved back to its old slot is asked afresh.
    """

    return {"$or": [build_closable_filter(), {"closed.reason": {"$in": sorted(REASONS_ANSWERING_THE_ANSETZUNG)}}]}


def build_held_filter(*, saison_id: str, spiel_ids: Sequence[Any]) -> dict[str, Any]:
    """These fixtures' rows holding their party's question about their Ansetzung."""

    return {"saison_id": saison_id, "spiel_id": {"$in": list(spiel_ids)}, **build_holding_filter()}


def _side_id(spiel: Mapping[str, Any], side: str) -> Any:
    block = spiel.get(side)

    return block.get("team_id") if isinstance(block, Mapping) else None


def _referee_id(spiel: Mapping[str, Any]) -> Any:
    block = spiel.get("schiedsrichter")

    return block.get("schiedsrichter_id") if isinstance(block, Mapping) else None


def reason_to_close(
    *, row: Mapping[str, Any], spiel: Mapping[str, Any], austritte: Mapping[Any, str], now: datetime
) -> FLSpielbestaetigungClosedReason | None:
    """Why this unclosed row stops applying to its fixture as it stands, or `None`; `austritte` maps clubs to exit days.

    The mint asks it of every row it would write, so the close shuts nothing the mint asked.
    """

    ansetzung = row["ansetzung"]
    clubs = (ansetzung["team1_id"], ansetzung["team2_id"])
    # First: a party taken off the fixture is told so, never that the match it no longer plays or officiates was called
    # off, decided or moved, a call-off's notice promising it the next request. A club taken off is the move's to tell,
    # which words it as taken off.
    if not still_a_party(row=row, spiel=spiel):
        return "schiedsrichter_switched" if row["party"]["kind"] == "schiedsrichter" else "ansetzung_changed"

    # Ahead of a move, neither leaving a new Ansetzung to announce; on the fixture's day as it stands, or the row's where
    # the fixture lost its date.
    tag = spiel.get("date") or ansetzung["date"]
    # Ahead of the decision a no-show records: entered before the day, nobody is due at the ground, so its
    # parties are told and shown a call-off.
    if clock.german_day(now) < tag and spiel.get("sonderereignis") in SONDEREREIGNIS_CALLING_OFF_BEFORE_ITS_DAY:
        return "cancelled"

    decided = decision_of(spiel=spiel, austritte=[austritte[team_id] for team_id in clubs if team_id in austritte], tag=tag)
    if decided is not None:
        return decided

    if ansetzung_digest_of(spiel) != ansetzung["digest"]:
        return "ansetzung_changed"

    # Last, so a move to or from a slot gone by is still announced. From the kick-off nobody answers: the match has
    # started, by the rule the report and the referee's list read, and a row kept open past it would ask about a past
    # slot for good, heading the close's oldest-first page.
    if _kicked_off(ansetzung, now=now):
        return "spiel_past"

    return None


def _kicked_off(ansetzung: Mapping[str, Any], *, now: datetime) -> bool:
    return is_played(date=ansetzung["date"], time=ansetzung["time"], now=now)


# What `reason_to_end` and `notice_owed` read of a row: the projection every reader of the close's judgement takes.
CLOSE_FIELDS: Final = ["saison_id", "spiel_id", "party", "ansetzung", "asked_at", "closed"]


def reason_to_end(
    *, row: Mapping[str, Any], spiel: Mapping[str, Any], austritte: Mapping[Any, str], now: datetime
) -> FLSpielbestaetigungClosedReason | None:
    """Why the pass's close shuts a row holding its party's question, or `None`."""

    reason = reason_to_close(row=row, spiel=spiel, austritte=austritte, now=now)
    if row.get("closed") is None or reason in REASONS_ENDING_AN_ANSWER:
        return reason

    # Its own kick-off, though the fixture moved: kept, a discard about an Ansetzung left would fill every pass's page.
    return "spiel_past" if _kicked_off(row["ansetzung"], now=now) else None


def request_is_due(*, spiel: Mapping[str, Any], austritte: Mapping[Any, str], now: datetime) -> bool:
    """Whether the mint asks about this fixture today: dated strictly after today, inside the answer window, fully set, undecided.

    The floor is a date because `has_taken_place` reads a record, so an unplayed fixture of the past reads as open; the
    day after today rather than the kick-off because a request asks ahead of the day, its deadline (`deadline_of`)
    lying before it.
    """

    today = clock.german_day(now)
    date = spiel.get("date")
    asked = (
        isinstance(date, str)
        and today < date <= last_request_day(today=today)
        and spiel.get("time") is not None
        and isinstance(spiel.get("spielort"), Mapping)
        and _side_id(spiel, "team1") is not None
        and _side_id(spiel, "team2") is not None
        and spiel.get("ergebnis") is None
        and spiel.get("sonderereignis") is None
    )

    # Never a row the close would shut: a club gone by the fixture's day, or a lone goal count or
    # shoot-out, would otherwise be minted, closed and minted again, a fresh request every pass. Asked as a side's row,
    # which is a party of the fixture as it stands.
    minted = {"party": {"kind": "team", "team_id": _side_id(spiel, "team1")}, "ansetzung": compose_ansetzung(spiel)}
    return asked and reason_to_close(row=minted, spiel=spiel, austritte=austritte, now=now) is None


def parties_of(spiel: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Every party a fixture's Ansetzung asks: both sides, and its referee where the booking names one."""

    parties: list[dict[str, Any]] = [{"kind": "team", "team_id": _side_id(spiel, side)} for side in ("team1", "team2")]
    schiedsrichter_id = _referee_id(spiel)
    if schiedsrichter_id is not None:
        parties.append({"kind": "schiedsrichter", "schiedsrichter_id": schiedsrichter_id})

    return parties


def party_key(party: Mapping[str, Any]) -> tuple[str, Any]:
    """One party as the unique index tells parties apart."""

    return party["kind"], party.get("team_id") if party["kind"] == "team" else party.get("schiedsrichter_id")


def compose_spielbestaetigung(
    *,
    row_id: Any,
    saison_id: str,
    spiel: Mapping[str, Any],
    party: Mapping[str, Any],
    today: str,
    asked: bool,
) -> dict[str, Any]:
    """A row as the mint writes it, about the fixture's Ansetzung as it stands.

    Stamped `asked` where the mint owes the row's party a mail in its own transaction: the stamp records the mail owed.
    """

    return {
        "_id": row_id,
        "saison_id": saison_id,
        "spiel_id": spiel["_id"],
        "party": dict(party),
        "ansetzung": compose_ansetzung(spiel),
        "deadline": deadline_of(date=spiel["date"], today=today),
        "asked_at": today if asked else None,
        "reminded_at": None,
        "answer": None,
        "closed": None,
    }


def build_reminder_filter(*, saison_id: str, today: str) -> dict[str, Any]:
    """The season's open team rows whose one reminder is due today: never reminded, their request owed on an earlier day.

    So never a row this pass's mint asked, whose request is the club's message of the day.
    """

    return {
        "saison_id": saison_id,
        **build_answerable_filter(),
        "party.kind": "team",
        "deadline": days_after(day=today, days=SPIEL_REMINDER_DAYS),
        "reminded_at": None,
        "asked_at": {"$nin": [None, today]},
    }


def compose_reminder_update(*, today: str) -> dict[str, Any]:
    """The day a row's one reminder was owed."""

    return {"$set": {"reminded_at": today}}


def build_unasked_filter() -> dict[str, Any]:
    """An open row whose request was never owed: minted while its club held no confirmed seat, asked once it does."""

    return {**build_answerable_filter(), "asked_at": None}


def compose_asked_update(*, today: str) -> dict[str, Any]:
    """The day a row's request was first owed."""

    return {"$set": {"asked_at": today}}


def compose_closing_update(*, reason: FLSpielbestaetigungClosedReason) -> dict[str, Any]:
    return {"$set": {"closed": {"reason": reason}}}


# --- The notices a closing owes, owed through the Postausgang in the closing's own transaction.


REASONS_OWING_A_NOTICE: Final = frozenset({"ansetzung_changed", "schiedsrichter_switched", "cancelled"})

# A referee alone: the exit's own write tells each opponent (`austritt_notices_of`), and the departed club owes itself nothing.
REASONS_OWING_A_REFEREE: Final = frozenset({"austritt"})


def _notice_to_come(*, row: Mapping[str, Any], reason: Any, spiel: Mapping[str, Any], now: datetime) -> bool:
    """Whether a notice is about a slot still to come, by the kick-off that closes the row.

    A move's is about the slot left, now void, and the fixture's slot, which a fresh request asks: either keeps it. By
    the day instead, a change entered between a kick-off and the next pass would be told or not by when that pass ran.
    """

    slots = [row["ansetzung"]]
    if reason == "ansetzung_changed" and isinstance(spiel.get("date"), str):
        slots.append(spiel)

    return any(not is_played(date=slot["date"], time=slot.get("time"), now=now) for slot in slots)


def notice_owed(*, row: Mapping[str, Any], reason: FLSpielbestaetigungClosedReason, spiel: Mapping[str, Any], now: datetime) -> bool:
    """Whether closing this row for `reason` owes its party a notice.

    Only once its request was owed, and about a slot to come.
    """

    owing = reason in REASONS_OWING_A_NOTICE or (reason in REASONS_OWING_A_REFEREE and row["party"]["kind"] == "schiedsrichter")

    return row.get("asked_at") is not None and owing and _notice_to_come(row=row, reason=reason, spiel=spiel, now=now)


def parties_told_of_the_change(
    *,
    rows: Iterable[Mapping[str, Any]],
    stored: Mapping[str, Any],
    changed: Mapping[str, Any],
    austritte: Mapping[Any, str],
    now: datetime,
) -> list[Mapping[str, Any]]:
    """The party of each of a fixture's `rows` holding its question that the pass closes owing a notice once `stored` is `changed`.

    Judged by the close's own rules (`reason_to_end`, `notice_owed`), so the page naming whom an act mails and the pass
    mailing them cannot disagree; a row the close ends as the fixture stands is no mail of the change. Whether a party
    is reached is the pass's: a club with no seat holding an address, or a referee with none, is told nothing.
    """

    told: list[Mapping[str, Any]] = []
    for row in rows:
        reason = reason_to_end(row=row, spiel=changed, austritte=austritte, now=now)
        if reason is None or reason == reason_to_end(row=row, spiel=stored, austritte=austritte, now=now):
            continue
        if notice_owed(row=row, reason=reason, spiel=changed, now=now):
            told.append(row["party"])

    return told


def spiel_mail_appointment_of(*, spielbestaetigung_raw: Mapping[str, Any], names: tuple[str, str]) -> FLSpielMailAppointment:
    """The slot a row was about, as a notice about it states it, the clubs named as `vereinsnamen_of` names them."""

    ansetzung = spielbestaetigung_raw["ansetzung"]

    return FLSpielMailAppointment(team1=names[0], team2=names[1], date=ansetzung["date"], time=ansetzung["time"])


def spiel_mail_ansetzung_of(view: FLSpielbestaetigungViewAnsetzung) -> FLSpielMailAnsetzung:
    """The fixture a request or an Einteilung asks about, as its mail states it."""

    return FLSpielMailAnsetzung(
        team1=view.team1_name,
        team2=view.team2_name,
        date=view.date,
        time=view.time,
        spielort=None if view.spielort is None else view.spielort.name,
    )


def notice_data_of(*, reason: FLSpielbestaetigungClosedReason, party_kind: str, appointment: FLSpielMailAppointment) -> FLOutboxData:
    """The notice a closing for `reason`, or a discard, owes a party of `party_kind`."""

    # A move's notice is `moved_notice_of`'s, which names the slot moved to as well, and a call-off's is
    # `cancelled_notice_of`'s, which names the event.
    if reason == "schiedsrichter_switched" or (reason in REASONS_OWING_A_REFEREE and party_kind == "schiedsrichter"):
        return FLSpielEinteilungLiftedData(kind="spiel_einteilung_lifted", appointment=appointment)
    if reason == "discarded":
        return FLSpielVorschlagDiscardedData(kind="spiel_vorschlag_discarded", appointment=appointment)

    raise ValueError(f"a closing for {reason} owes no notice")


def _recipient_of(party_kind: str) -> Literal["team", "schiedsrichter"]:
    """Who a notice to a party of `party_kind` is worded for."""

    return "schiedsrichter" if party_kind == "schiedsrichter" else "team"


def cancelled_notice_of(*, party_kind: str, appointment: FLSpielMailAppointment, sonderereignis: FLSpielNoticeEvent) -> FLSpielNoticeData:
    """The notice a closing for `cancelled` owes a party of `party_kind`: the slot it was asked about, and what befell it."""

    return FLSpielNoticeData(
        kind="spiel_cancelled",
        recipient=_recipient_of(party_kind),
        appointment=appointment,
        sonderereignis=sonderereignis,
    )


def moved_notice_of(
    *, party_kind: str, appointment: FLSpielMailAppointment, moved_to: FLSpielMailAppointment | None, asked_again: bool
) -> FLSpielMovedData:
    """The „Spiel verlegt“ notice a party of `party_kind` is owed where no request about the fixture's new slot goes now."""

    return FLSpielMovedData(
        kind="spiel_moved",
        recipient=_recipient_of(party_kind),
        appointment=appointment,
        moved_to=moved_to,
        asked_again=asked_again,
    )


def spiel_mail_slot_of(spiel: Mapping[str, Any]) -> FLSpielMailAppointment | None:
    """The slot a fixture holds now, as a notice of its move names it, or `None` where it lacks a day, an hour or a side."""

    date, time, team1, team2 = spiel.get("date"), spiel.get("time"), spiel.get("team1"), spiel.get("team2")
    if not (isinstance(date, str) and isinstance(time, str) and isinstance(team1, Mapping) and isinstance(team2, Mapping)):
        return None

    return FLSpielMailAppointment(team1=str(team1["name"]), team2=str(team2["name"]), date=date, time=time)


def still_a_party(*, row: Mapping[str, Any], spiel: Mapping[str, Any]) -> bool:
    """Whether the row's party is one the fixture asks as it stands: a side, or its referee."""

    return party_key(row["party"]) in {party_key(party) for party in parties_of(spiel)}


def asked_with_its_move(*, row: Mapping[str, Any], spiel: Mapping[str, Any], austritte: Mapping[Any, str], now: datetime) -> bool:
    """Whether this row about a slot its fixture left is the mint's to close: its party still the fixture's, the new slot asked today.

    The mint closes it in the transaction asking about the new slot, so the request is the one mail telling of the
    move; the close step leaves it, and tells of any other move at once.
    """

    return (
        reason_to_close(row=row, spiel=spiel, austritte=austritte, now=now) == "ansetzung_changed"
        and still_a_party(row=row, spiel=spiel)
        and request_is_due(spiel=spiel, austritte=austritte, now=now)
    )


def reference_of(*, spielbestaetigung_id: Any, seat: FLKontaktRolle | None) -> FLOutboxReference:
    """The row a fixture mail is about, and the seat of its club it went to."""

    return FLOutboxReference(collection=Collection.SPIELBESTAETIGUNGEN, id=spielbestaetigung_id, seat=seat)


def team_mails(*, spielbestaetigung_raw: Mapping[str, Any], kontakte: Any, data: FLOutboxData, occasion: str) -> list[OwedMail]:
    """A team row's mail, one per mailbox of its club's confirmed seats as they stand now, keyed by the row, the occasion and the seat.

    An address nobody proved is mailed nothing, as no invitation goes to one.
    """

    row_id = spielbestaetigung_raw["_id"]

    return [
        OwedMail(
            key=f"spielbestaetigung/{row_id}/{occasion}/{recipient.rolle}",
            to=recipient.email,
            data=data,
            reference=reference_of(spielbestaetigung_id=row_id, seat=recipient.rolle),
            club=FLOutboxClub(saison_id=spielbestaetigung_raw["saison_id"], team_id=spielbestaetigung_raw["party"]["team_id"]),
        )
        for recipient in confirmed_recipients(kontakte=kontakte)
    ]


# --- The notice an Austritt owes each opponent, at the exit's own write: a fixture past the asking window holds no row to close.


def build_austritt_spiele_filter(*, saison_id: str, team_id: Any, exit_day: str) -> dict[str, Any]:
    """The club's fixtures its exit reaches: from the day on, as `decision_of` counts it, or undated; `austritt_notices_of` decides."""

    return {
        "saison_id": saison_id,
        "$and": [
            {"$or": [{"team1.team_id": team_id}, {"team2.team_id": team_id}]},
            {"$or": [{"date": None}, {"date": {"$gte": exit_day}}]},
        ],
    }


def austritt_notices_of(
    *, saison_id: str, team_id: Any, spiele: Iterable[Mapping[str, Any]], vereine: Mapping[Any, Mapping[str, Any]]
) -> dict[Any, list[OwedMail]]:
    """Each opponent's notice, one mail per mailbox of its confirmed seats, keyed by that row; `vereine` maps clubs to their season rows.

    One notice however many fixtures, listing every one still open: neither decided, nor called off, nor closed to the
    opponent by an exit of its own. Keyed by the two clubs and the seat, never the day: an exit moved earlier tells the
    opponents it newly reaches, and nobody twice. Each mail is about the departed club's row: on the opponent's seat it
    would stand in for the seat's link mail, whose delivery the team editor reads.
    """

    open_spiele: dict[Any, list[FLSpielMailEntry]] = {}
    ordered = sorted(spiele, key=lambda spiel: (spiel.get("date") is None, spiel.get("date") or "", spiel.get("time") or ""))
    for spiel in ordered:
        team1, team2 = _side_id(spiel, "team1"), _side_id(spiel, "team2")
        opponent = vereine.get(team2 if team1 == team_id else team1)
        if opponent is None or team1 is None or team2 is None:
            continue

        own_exit = (opponent.get("austritt") or {}).get("date")
        if decision_of(spiel=spiel, austritte=[] if own_exit is None else [own_exit], tag=spiel.get("date")) is None:
            open_spiele.setdefault(opponent["team_id"], []).append(
                FLSpielMailEntry(team1=vereine[team1]["name"], team2=vereine[team2]["name"], date=spiel.get("date"), time=spiel.get("time"))
            )

    departed = vereine[team_id]
    reference = FLOutboxReference(collection=Collection.SAISON_TEAMS, id=departed["_id"], seat=None)
    notices: dict[Any, list[OwedMail]] = {}
    for opponent_id, listed in open_spiele.items():
        opponent = vereine[opponent_id]
        data = FLAustrittNoticeData(kind="austritt_notice", team=departed["name"], saison_id=saison_id, spiele=listed)
        mails = [
            OwedMail(
                key=f"austritt/{saison_id}/{team_id}/{opponent_id}/{recipient.rolle}",
                to=recipient.email,
                data=data,
                reference=reference,
                club=FLOutboxClub(saison_id=saison_id, team_id=opponent_id),
            )
            for recipient in confirmed_recipients(kontakte=opponent.get("kontakte"))
        ]
        if mails:
            notices[opponent["_id"]] = mails

    return notices


# --- The season's end: what it strips off the season's rows.


def build_season_reasons_filter(saison_id: str) -> dict[str, Any]:
    """This season's rows holding a reason, whoever gave it and whatever the party: the season's end takes every one, the answer's way kept."""

    return {"saison_id": saison_id, "answer.reason": {"$ne": None}}


# --- A seat holder's erasure or Widerspruch: the reasons typed from the seats they hold, matched by team, season and role.


class HeldSeats(NamedTuple):
    """The seats one person leaves on one season row, keyed as its team's rows name them."""

    saison_id: Any
    team_id: Any
    seats: tuple[str, ...]


def build_seat_reasons_filter(held: Sequence[HeldSeats]) -> dict[str, Any]:
    """Every row of these teams in these seasons answered from one of these seats and still holding a reason, closed since or not.

    Matched on the seat, the one thing an answer records of who gave it: a reason an earlier holder typed from the seat
    goes too, and one this person typed from a seat they have left stays until the season's end strips it.
    """

    return {
        "party.kind": "team",
        "answer.by.kind": "kontakt",
        "answer.reason": {"$ne": None},
        "$or": [
            {"saison_id": seats.saison_id, "party.team_id": seats.team_id, "answer.by.rolle": {"$in": list(seats.seats)}} for seats in held
        ],
    }


# --- The referee's erasure: which rows name the person.


def build_referee_rows_filter(schiedsrichter_ids: Sequence[Any]) -> Mapping[str, Any]:
    """Every row whose party is one of these referees, open, answered or closed."""

    return {"party.kind": "schiedsrichter", "party.schiedsrichter_id": {"$in": list(schiedsrichter_ids)}}
