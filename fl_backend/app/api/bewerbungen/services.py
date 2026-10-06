import hashlib
import json
import secrets
from collections.abc import Collection, Iterable, Mapping, Sequence
from datetime import date, timedelta
from http import HTTPStatus
from typing import Any, Final, Literal, cast, get_args

from pydantic import BaseModel, ValidationError

from app.api.bewerbungen.schemas import (
    FLBewerbungEinwilligungZustand,
    FLBewerbungEntscheidung,
    FLBewerbungSaisonbezug,
    FLKontaktRolle,
    refuse_age_outside_the_bounds,
)
from app.api.kontakte.services import rows_possibly_naming
from app.api.sperrliste.services import withheld_actor
from app.api.teams.schemas import KONTAKT_ROLLEN, FLKontaktEingetragenVon, FLPostTeamPayload, FLTrikotFarbe
from app.core.crud import build_sort
from app.core.exceptions import WriteRefusal
from app.core.recording import log_stamp
from app.shared.einwilligung import UNCONFIRMED_STAMP, is_confirmed
from app.shared.einwilligung_nachweis import SPRECHER, compose_wahlen
from app.shared.folding import mailbox_key, sign_in_identifier
from app.shared.schemas.bounds import (
    BEWERBUNG_BESTAETIGUNG_FRIST_TAGE,
    BEWERBUNG_ERINNERUNG_TAGE,
    BEWERBUNG_KONTAKT_MIN_AGE_YEARS,
    LIST_LIMIT_MAX,
    SAISON_ID_LENGTH,
    VERTRETUNG_MIN_AGE_YEARS,
)

# What every code below refuses is `fl_backend/app/core/domain.py :: RULES`.
BEWERBUNG_ALREADY_DECIDED = "REQ-BEWERBUNG-001"
BEWERBUNG_SUBJECT_UNRESOLVED = "REQ-BEWERBUNG-002"
BEWERBUNG_SCHULE_UNUSABLE = "REQ-BEWERBUNG-003"
BEWERBUNG_FENSTER_GESCHLOSSEN = "REQ-BEWERBUNG-004"
BEWERBUNG_SUBMISSION_SUBJECT_UNRESOLVED = "REQ-BEWERBUNG-005"
BEWERBUNG_PICKED_CLUB_UNUSABLE = "REQ-BEWERBUNG-006"
BEWERBUNG_PICKED_CLUB_ALREADY_ENTERED = "REQ-BEWERBUNG-007"
BEWERBUNG_SHORTHAND_TAKEN = "REQ-BEWERBUNG-008"
BEWERBUNG_TOKEN_UNKNOWN = "REQ-BEWERBUNG-009"
# A decision is final, so the link is spent for good; a deadline a re-send restarts is not, so it
# is a code of its own at the state's status.
BEWERBUNG_TOKEN_DECIDED = "REQ-BEWERBUNG-010"
BEWERBUNG_SEAT_ALREADY_ANSWERED = "REQ-BEWERBUNG-011"
BEWERBUNG_KONTAKT_ALTER = "REQ-BEWERBUNG-012"
BEWERBUNG_KONTAKTE_UNCONFIRMED = "REQ-BEWERBUNG-013"
BEWERBUNG_KONTAKT_EMAIL_TAKEN = "REQ-BEWERBUNG-014"
BEWERBUNG_SCHLUESSEL_ABWEICHEND = "REQ-BEWERBUNG-015"
BEWERBUNG_TOKEN_PAST_DEADLINE = "REQ-BEWERBUNG-017"
BEWERBUNG_ADRESSE_GESPERRT = "REQ-BEWERBUNG-018"
BEWERBUNG_KONTAKT_GESPERRT = "REQ-BEWERBUNG-019"
BEWERBUNG_EINWILLIGUNG_GESPERRT = "REQ-BEWERBUNG-020"

# `bewerbung: null` and no key are both the closed window, never an error (`FLSaison.bewerbung`
# defaults).
_WINDOW_FIELDS = ("offen", "von", "bis")


def find_triage_refusal(*, status: str) -> WriteRefusal | None:
    """Why this application may no longer be decided, or `None`.

    ONE code for both endpoints: which of the two arrived second is nothing an administrator can act
    on differently. Without it a second press re-enters the club, failing on a duplicate key.
    """

    if status != "eingereicht":
        return WriteRefusal(
            error_code=BEWERBUNG_ALREADY_DECIDED,
            status=HTTPStatus.CONFLICT,
            message=f"this application is already {status}; a decision is taken once, and the record of it stands",
        )

    return None


def find_acceptance_subject_refusal(*, team_id: Any | None, schule: Mapping[str, Any] | None) -> WriteRefusal | None:
    """Why this application resolves to no single club to enter, or `None`.

    While it is `eingereicht`, EXACTLY one of the two carries a value -- a rule the write path holds
    because types and enums cannot state it (`docs/backend/spec.md :: I16`).
    """

    if (team_id is None) == (schule is None):
        named = "both an existing club and a new school" if team_id is not None else "neither an existing club nor a new school"
        return WriteRefusal(
            error_code=BEWERBUNG_SUBJECT_UNRESOLVED,
            status=HTTPStatus.CONFLICT,
            message=f"this application names {named}; exactly one of the two says what acceptance would enter into the season",
        )

    return None


# The school's field names in the club's. `team_name` becomes the club's `name`; the other five are
# spelled alike on both sides, and `description` is on neither.
_CLUB_FIELDS_FROM_SCHULE = {
    "team_name": "name",
    "full_name": "full_name",
    "shorthand": "shorthand",
    "schulform": "schulform",
    "address": "address",
    "website_url": "website_url",
}


def compose_new_club(*, schule: Any) -> dict[str, Any]:
    """The club document acceptance would create, from the school's block AS STORED.

    Raw so `find_new_club_refusal` judges every field: a `str()` here makes a club named `'None'`
    from a null with no undo, and a subscript 500s where the rule promises 409.
    """

    fields = schule if isinstance(schule, Mapping) else {}

    return {
        # Empty rather than composed from the application: `description` is the club's own public
        # blurb, and a sentence the league wrote would stand on the team page as though the school
        # had written it.
        "description": "",
        # A key the block has not got is left OUT rather than defaulted, so the guard names it
        # "Field required" rather than judging a null nobody submitted.
        **{club_field: fields[schule_field] for schule_field, club_field in _CLUB_FIELDS_FROM_SCHULE.items() if schule_field in fields},
    }


def parse_new_club(*, club_document: Mapping[str, Any]) -> dict[str, Any]:
    """The club document AS STORED, from one the guard has already passed.

    Parsed, not composed: `website_url`'s validator strips tab, return and newline, so the raw
    block leaves `teams` holding what `POST /teams` never stores for the same school.
    """

    return FLPostTeamPayload.model_validate(club_document).model_dump(mode="json")


def find_new_club_refusal(*, club_document: Mapping[str, Any]) -> WriteRefusal | None:
    """Why the school's details make no club, or `None`.

    Through the payload itself, never a copy: the validator only types them
    (`docs/backend/spec.md :: I16`), so a scheme-less `website_url` reaches storage, and `FLTeam`
    500s every club read.
    """

    try:
        FLPostTeamPayload.model_validate(club_document)
    # NARROW on purpose: anything else raised here is a fault in this code, and a 409 blaming the
    # school for one is a refusal nobody can act on.
    except ValidationError as unusable_school:
        first = unusable_school.errors()[0]
        # The field PATH and the reason, never a submitted value -- this block holds a real school's
        # address (`docs/logging/spec.md :: L9`). `compose_new_club` keys the document by the payload's
        # own field names, so the path is one of those and nothing typed.
        field = ".".join(str(part) for part in first["loc"]) or "schule"

        return WriteRefusal(
            error_code=BEWERBUNG_SCHULE_UNUSABLE,
            status=HTTPStatus.CONFLICT,
            message=f"this school's {field} is not one a club can be created from: {first['msg']}",
        )

    return None


# --- The PUBLIC submission. Every refusal below is judged before the one write, in the order the
# router asks them in.


def recorded_window(*, bewerbung: Any) -> Mapping[str, Any] | None:
    """The window this stored value IS, or `None` where a reader could not subscript it.

    Short of one it is unreadable, so each caller answers its own miss rather than 500ing on the
    subscript.
    """

    if not isinstance(bewerbung, Mapping) or not all(field in bewerbung for field in _WINDOW_FIELDS):
        return None

    return bewerbung


def window_is_running(*, bewerbung: Any, today: str) -> bool:
    """Whether this season's application window runs on `today`: `offen`, AND the day inside the span.

    Both ends are compared rather than assuming `von <= bis`: span ordering is enforced on the
    season PAYLOAD alone, so a stored reversal is reachable.
    """

    if recorded_window(bewerbung=bewerbung) is None:
        return False

    return bool(bewerbung["offen"]) and str(bewerbung["von"]) <= today <= str(bewerbung["bis"])


def saison_nimmt_bewerbungen_an(*, saison_status: Any, bewerbung: Any, today: str) -> bool:
    """Whether this season takes an application on `today`.

    A finished season's window is over for good, whatever dates it still stores: the payload names
    the season, and the dates alone would still admit an application into one that has ended.
    """

    return not season_has_ended(saison_status=saison_status) and window_is_running(bewerbung=bewerbung, today=today)


# `season_has_ended`'s negation for a read that narrows in the query. No stored season lacks a
# status, the validator requiring one (`app/core/constraints.py :: COLLECTION_VALIDATORS`), which is why
# the readers of this filter's rows subscript it.
SAISON_NOT_ENDED_FILTER: Final[Mapping[str, Any]] = {"status": {"$ne": "past"}}


def find_window_refusal(*, saison_status: Any, bewerbung: Any, today: str) -> WriteRefusal | None:
    """Why this season is taking no application today, or `None`.

    ONE code for every way `saison_nimmt_bewerbungen_an` says no: naming which would report a
    season's administrative state to an anonymous visitor.
    """

    if saison_nimmt_bewerbungen_an(saison_status=saison_status, bewerbung=bewerbung, today=today):
        return None

    return WriteRefusal(
        error_code=BEWERBUNG_FENSTER_GESCHLOSSEN,
        status=HTTPStatus.CONFLICT,
        message="this season is not accepting applications today; the application window is closed",
    )


def find_submission_subject_refusal(*, team_id: Any | None, schule: Any | None) -> WriteRefusal | None:
    """Why this submission resolves to no single school, or `None`.

    Its OWN code beside `find_acceptance_subject_refusal`, which asks this of a STORED application:
    one code would leave a public refusal and a triage refusal alike in the log.
    """

    if (team_id is None) == (schule is None):
        named = "both an existing club and a new school" if team_id is not None else "neither an existing club nor a new school"
        return WriteRefusal(
            error_code=BEWERBUNG_SUBMISSION_SUBJECT_UNRESOLVED,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            fields=(("team_id",), ("schule",)),
            message=f"this submission names {named}; exactly one of the two says which school is applying",
        )

    return None


def find_picked_club_refusal(*, team_raw: Mapping[str, Any] | None) -> WriteRefusal | None:
    """Why the club the applicant picked is not one to apply as, or `None`.

    ONE code for a club that does not exist and one that has left: the picker offers neither, so
    either answer means the same thing -- a client sending an id it was never given.
    """

    if team_raw is None or team_raw.get("inactive_since") is not None:
        return WriteRefusal(
            error_code=BEWERBUNG_PICKED_CLUB_UNUSABLE,
            status=HTTPStatus.CONFLICT,
            message=(
                "the club this submission names is not one the league offers; reload the list and pick again, "
                "or propose a new school under a shorthand no club holds"
            ),
        )

    return None


def find_already_entered_refusal(*, entered: bool) -> WriteRefusal | None:
    """Why this club may not apply for this season, or `None`.

    A club already holding the season's junction row is IN it, so an application would ask for
    something already granted. A shared season is not refused: two schools may apply on one day.
    """

    if entered:
        return WriteRefusal(
            error_code=BEWERBUNG_PICKED_CLUB_ALREADY_ENTERED,
            status=HTTPStatus.CONFLICT,
            message="this club already plays the season this submission applies for",
        )

    return None


def find_shorthand_refusal(*, taken: bool) -> WriteRefusal | None:
    """Why the proposed Kürzel cannot be the new school's, or `None`.

    Asked here as well as by the availability check, which narrows the collision without preventing
    it: acceptance would otherwise fail on a duplicate key, the school already told it applied.
    """

    if taken:
        return WriteRefusal(
            error_code=BEWERBUNG_SHORTHAND_TAKEN,
            status=HTTPStatus.CONFLICT,
            message="the shorthand this submission proposes already belongs to a club; choose another",
        )

    return None


# --- The SUBMISSION KEY (`docs/backend/spec.md :: I346`), which the registration's
# submission takes from here as it takes `mint_token`.


def payload_fingerabdruck(payload: BaseModel) -> str:
    """The digest a replayed key's payload is compared by.

    Over the VALIDATED payload: two spellings the model stores alike, or one body serialised in two
    key orders, are one request. Keys sorted, so a mapping-typed field cannot reorder it.
    """

    canonical = json.dumps(payload.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False)

    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def build_schluessel_filter(*, schluessel: str) -> Mapping[str, Any]:
    """The key lookup, carrying the unique index's partial term.

    An equality alone does not imply `$type`, so without the term the planner scans the whole collection.
    """

    return {"idempotenz_schluessel": {"$eq": schluessel, "$type": "string"}}


def find_abweichender_fingerabdruck_refusal(*, gespeichert: Any, fingerabdruck: str) -> WriteRefusal | None:
    """Why this key cannot be replayed, or `None`: it already carries an application sent with other details.

    Refused rather than answered as the stored one, which would tell the applicant a changed field
    had arrived.
    """

    if gespeichert == fingerabdruck:
        return None

    return WriteRefusal(
        error_code=BEWERBUNG_SCHLUESSEL_ABWEICHEND,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        message="this submission key already carries an application sent with other details; the first one stands as it was sent",
    )


def build_wiederholung_filter(*, bewerbung_raw: Mapping[str, Any], today: str) -> Mapping[str, Any] | None:
    """The state a replay hands fresh links in, as its update's filter; `None` where a seat holds no live entry.

    No seat answered, reminded or on record as reached by a mail (`docs/backend/spec.md :: I347`).
    """

    block = bewerbung_raw.get("bestaetigungen")
    entries = {seat: _entry_of(block, seat) for seat in KONTAKT_ROLLEN}

    terms: dict[str, Any] = {}
    unerreicht: list[Mapping[str, Any]] = []
    for seat, entry in entries.items():
        if entry is None or not isinstance(entry.get("token_hash"), str):
            return None

        terms[f"bestaetigungen.{seat}.erinnert_am"] = None
        terms[f"bestaetigungen.{seat}.abgelehnt_am"] = None
        terms[f"kontakte.{seat}.einwilligung.bestaetigt_am"] = UNCONFIRMED_STAMP
        unerreicht.append(zustellung_unerreicht_term(pfad=f"bestaetigungen.{seat}.zustellung"))

    # The deadline's own day still takes a link, as `link_is_over` reads it.
    return {"_id": bewerbung_raw["_id"], "status": "eingereicht", "bestaetigungsfrist": {"$gte": today}, **terms, "$and": unerreicht}


# The two states in which no message reached the inbox: the provider refused the address, or never sent
# to it. `beschwerde` is not one -- that message arrived, and its reader complained about it.
ZUSTELLUNG_NICHT_ANGEKOMMEN: Final = ("unterdrueckt", "unzustellbar")


def zustellung_unerreicht_term(*, pfad: str) -> Mapping[str, Any]:
    """No message on record under `pfad`, or only one that never arrived: a replay then mails, as the first press would have.

    A refused send left unmailed would answer a receipt promising a mail nobody got.
    """

    return {"$or": [{pfad: None}, {f"{pfad}.stand": {"$in": list(ZUSTELLUNG_NICHT_ANGEKOMMEN)}}]}


def compose_wiederholung_update(*, hashes: Mapping[str, str], bestaetigungen: Any) -> Mapping[str, Any]:
    """The replaced hash is kept live rather than voided: a mail that went out unrecorded still holds it.

    Neither `erinnert_am` nor the deadline moves, a replay being neither a reminder nor a re-send.
    """

    written: dict[str, Any] = {}
    for seat, token_hash in hashes.items():
        entry = _entry_of(bestaetigungen, seat) or {}
        written[f"bestaetigungen.{seat}.token_hash"] = token_hash
        written[f"bestaetigungen.{seat}.token_hash_zuvor"] = entry.get("token_hash")

    return {"$set": written}


def compose_einwilligung(*, text_version: str, today: str, eingetragen_von: FLKontaktEingetragenVon) -> dict[str, Any]:
    """The contact seat's record as the server writes it: who seated the person, and nothing they answered.

    Named by no client, who could otherwise dress a transcription as a signature.
    """

    # `medien` written false rather than left off: nobody filling a seat for another person may give
    # that person's media consent.
    return {
        "umfang": "kontaktdaten",
        "text_version": text_version,
        "datum": today,
        "bestaetigt_am": None,
        "medien": False,
        "eingetragen_von": eingetragen_von,
    }


# Every seat, so a fourth one is a `KeyError` at the confirmation rather than a silent sixteen
# (`docs/backend/spec.md :: I180`).
SEAT_MIN_AGE_YEARS: Mapping[str, int] = {
    "trainer": BEWERBUNG_KONTAKT_MIN_AGE_YEARS,
    "ansprechperson": VERTRETUNG_MIN_AGE_YEARS,
    "stellvertretung": VERTRETUNG_MIN_AGE_YEARS,
}


def mindestalter_for(seats: Sequence[str]) -> int:
    """The floor the PERSON clears: the highest any seat they hold asks for.

    Never the pressed seat's, or a Trainer sitting in one of the other two passes at sixteen.
    """

    return max(SEAT_MIN_AGE_YEARS[seat] for seat in seats)


def compose_kontakte(*, kontakte: Mapping[str, Any], today: str) -> dict[str, Any]:
    """The three people as `saison_teams` stores them, each seat's record recomposed here.

    Taken as the DUMPED payload rather than the model: this module composes documents, and every
    other function here takes one.
    """

    composed: dict[str, Any] = {
        seat: {
            **{field: value for field, value in kontakte[seat].items() if field != "einwilligung"},
            # Written null rather than left off, as `wunschgegner` is: the key marks a date not yet
            # entered, and the confirmation fills it (`docs/backend/spec.md :: I141`).
            "geburtsdatum": None,
            "einwilligung": compose_einwilligung(
                text_version=kontakte[seat]["einwilligung"]["text_version"], today=today, eingetragen_von="bewerbung"
            ),
        }
        for seat in KONTAKT_ROLLEN
    }
    composed["trainer_ist_zugleich"] = kontakte["trainer_ist_zugleich"]

    return composed


# --- The CONFIRMATION. Every predicate below reads a missing `bestaetigungen` block as "nothing to
# confirm": an application stored before the flow shipped is neither refused nor swept.

KONTAKT_UMFANG = "kontaktdaten"
KONTAKT_UMFANG_WHATSAPP = "kontaktdaten_whatsapp"


def hash_token(raw: str) -> str:
    """The form the database holds a token in.

    UNKEYED: 256 random bits have no dictionary to search, and a pepper would cost a backend
    environment name reaching the server, CI and the local stack.
    """

    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def mint_token() -> tuple[str, str]:
    """A raw token and its hash. The raw one goes to the response and the inbox, and nowhere else."""

    raw = secrets.token_urlsafe(32)

    return raw, hash_token(raw)


def days_after(*, day: str, days: int) -> str:
    return (date.fromisoformat(day) + timedelta(days=days)).isoformat()


def bestaetigungsfrist_from(*, today: str) -> str:
    """The day the links stop working and the application is deleted, counted from the mint -- a re-send restarts it."""

    return days_after(day=today, days=BEWERBUNG_BESTAETIGUNG_FRIST_TAGE)


def compose_bestaetigung(*, token_hash: str, today: str) -> dict[str, Any]:
    """One seat's bookkeeping as the create and the re-send write it: a live hash, mailed today, nobody reminded, nobody declined."""

    return {"token_hash": token_hash, "verschickt_am": today, "erinnert_am": None, "abgelehnt_am": None}


def compose_bestaetigungen(*, hashes: Mapping[str, str], today: str) -> dict[str, Any]:
    return {seat: compose_bestaetigung(token_hash=hashes[seat], today=today) for seat in KONTAKT_ROLLEN}


# A reminder's fresh hash and the first mail's, both live: a reader still looking at the first
# message is not punished by the chase, and only an administrator's re-send voids
# (`docs/backend/spec.md :: I152`).
TOKEN_HASH_FIELDS = ("token_hash", "token_hash_zuvor")


# The admin reads' projection, and the FIRST exclusion projection in this tree: an inclusion list
# would have to restate every field an application holds. Derived from the pair above, so a third
# hash field cannot reach a read.
WITHOUT_TOKEN_HASHES: Mapping[str, int] = {f"bestaetigungen.{seat}.{field}": 0 for seat in KONTAKT_ROLLEN for field in TOKEN_HASH_FIELDS}


def _per_seat(block: str, *fields: str) -> dict[str, int]:
    """Each seat's copy of these paths, included, so a fourth seat cannot fall out of a read."""

    return {f"{block}.{seat}.{field}": 1 for seat in KONTAKT_ROLLEN for field in fields}


# What decides which page a seat's link opens (`kontakt_seite_of`): who seated its person, and the
# day a record stored before that field carries.
KONTAKT_SEITE_FIELDS: Final = ("einwilligung.eingetragen_von", "einwilligung.datum")


# What an answer moves on each seat, read before it: a withdrawal keeps the grant it ended.
KONTAKT_WAHL_FIELDS: Final = ("einwilligung.umfang", "einwilligung.medien", "einwilligung.nachweis")


# An INCLUSION, and never the exclusion above inverted: these two answer a closed handful, so the
# rest of the document is what a base-tier read must not hold
# (`docs/backend/spec.md :: READ-CONTACT-001`). Both hashes, which `seat_holding` compares.
EINWILLIGUNG_ANSICHT_FIELDS: Mapping[str, int] = {
    **_per_seat("bestaetigungen", *TOKEN_HASH_FIELDS, "abgelehnt_am"),
    # The address for the ban list alone, as the answer's read takes it: the response model declares
    # no field to carry it.
    **_per_seat("kontakte", "vorname", "email", "einwilligung.bestaetigt_am", "einwilligung.text_version", *KONTAKT_SEITE_FIELDS),
    # A declaration naming a seat, holding nobody's details: `paired_seat` reads it, and the view
    # serves only the pair it resolves for this link's own seat.
    "kontakte.trainer_ist_zugleich": 1,
    "saison_id": 1,
    "status": 1,
    "bestaetigungsfrist": 1,
    "eingereicht_am": 1,
    "schule.team_name": 1,
    "team_id": 1,
    # Suppressed here alone: an inclusion projection answers `_id` unasked, and only the answer's
    # read below has a patch filter to key on it.
    "_id": 0,
}

# Narrower than the view's: the answer takes its wording from the payload and names no school. The
# address is what a consent asks the ban list of, and no answer carries it.
EINWILLIGUNG_ANTWORT_FIELDS: Mapping[str, int] = {
    **_per_seat("bestaetigungen", *TOKEN_HASH_FIELDS, "abgelehnt_am"),
    # The choices and their evidence, so a withdrawal names the grant it ends (`compose_wahlen`).
    **_per_seat("kontakte", "vorname", "email", "einwilligung.bestaetigt_am", *KONTAKT_WAHL_FIELDS, *KONTAKT_SEITE_FIELDS),
    "kontakte.trainer_ist_zugleich": 1,
    "saison_id": 1,
    "status": 1,
    "bestaetigungsfrist": 1,
    "eingereicht_am": 1,
}


def build_token_filter(*, token_hash: str) -> Mapping[str, Any]:
    """Every seat path and both hashes, so the hash alone finds the seat. No status term: a reopened link shows its own state."""

    return {"$or": [{f"bestaetigungen.{seat}.{field}": token_hash} for seat in KONTAKT_ROLLEN for field in TOKEN_HASH_FIELDS]}


def seat_named(value: Any) -> FLKontaktRolle | None:
    """The seat this value names, or `None`: a path segment and a stored key are both only as trustworthy as whatever wrote them."""

    return cast(FLKontaktRolle, value) if value in get_args(FLKontaktRolle) else None


def seat_holding(*, bewerbung_raw: Mapping[str, Any], token_hash: str) -> FLKontaktRolle | None:
    """Which seat's hash this is, read off the document the filter found rather than off a second query."""

    block = bewerbung_raw.get("bestaetigungen")
    if not isinstance(block, Mapping):
        return None

    for seat in KONTAKT_ROLLEN:
        entry = block.get(seat)
        if isinstance(entry, Mapping) and any(entry.get(field) == token_hash for field in TOKEN_HASH_FIELDS):
            return seat_named(seat)

    return None


def find_unknown_token_refusal(*, seat: FLKontaktRolle | None) -> WriteRefusal | None:
    """Why this token opens nothing, or `None`.

    ONE answer for unknown, voided by a re-send, and deleted with the application: nothing
    distinguishes them from a stranger's guess, and naming which would say more than the guess knew.
    """

    if seat is None:
        return WriteRefusal(
            error_code=BEWERBUNG_TOKEN_UNKNOWN,
            status=HTTPStatus.NOT_FOUND,
            message="this link opens no seat of any application; it may have been replaced by a newer one, or the application is gone",
        )

    return None


def _is_decided(status: Any) -> bool:
    return status != "eingereicht"


def _deadline_passed(*, bestaetigungsfrist: Any, today: str) -> bool:
    return isinstance(bestaetigungsfrist, str) and bestaetigungsfrist < today


def link_is_over(*, bestaetigungsfrist: Any, status: Any, today: str) -> bool:
    """Whether the link is over: the deadline has passed, or the application was decided while the seat stood open."""

    return _is_decided(status) or _deadline_passed(bestaetigungsfrist=bestaetigungsfrist, today=today)


def find_expired_token_refusal(*, bestaetigungsfrist: Any, status: Any, today: str) -> WriteRefusal | None:
    """Why this link is over, or `None`. Judged before the seat: a seat on a decided application is never answered again."""

    if _is_decided(status):
        return WriteRefusal(
            error_code=BEWERBUNG_TOKEN_DECIDED,
            status=HTTPStatus.GONE,
            message="this link has expired: the application has been decided",
        )

    # The deadline is the application's one field, and a re-send of any seat restarts it, so every
    # other seat's link answers again (`compose_erneut_update`): a conflict with state, not a spent link.
    if _deadline_passed(bestaetigungsfrist=bestaetigungsfrist, today=today):
        return WriteRefusal(
            error_code=BEWERBUNG_TOKEN_PAST_DEADLINE,
            status=HTTPStatus.CONFLICT,
            message="the application's confirmation deadline has passed; a fresh link from the administration reopens it",
        )

    return None


def _seat_is_confirmed(kontakte: Any, seat: str) -> bool:
    slot = kontakte.get(seat) if isinstance(kontakte, Mapping) else None

    return is_confirmed(slot.get("einwilligung") if isinstance(slot, Mapping) else None)


def _declined_on(bestaetigungen: Any, seat: str) -> Any:
    entry = bestaetigungen.get(seat) if isinstance(bestaetigungen, Mapping) else None

    return entry.get("abgelehnt_am") if isinstance(entry, Mapping) else None


def seat_is_answered(*, kontakte: Any, bestaetigungen: Any, seat: str) -> bool:
    """Whether this seat's person has spoken: a stamp on the slot, a decline beside it, or no bookkeeping.

    No bookkeeping is an application stored before the flow, or a seat an erasure emptied; neither
    has anything left to answer.
    """

    if _seat_is_confirmed(kontakte, seat) or _declined_on(bestaetigungen, seat) is not None:
        return True

    return not isinstance(bestaetigungen, Mapping) or not isinstance(bestaetigungen.get(seat), Mapping)


def find_already_answered_refusal(*, kontakte: Any, bestaetigungen: Any, seat: str) -> WriteRefusal | None:
    """Why this seat takes no second answer, or `None`. The single use: the stamps are what spend a link, never a nulled hash."""

    if seat_is_answered(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=seat):
        return WriteRefusal(
            error_code=BEWERBUNG_SEAT_ALREADY_ANSWERED,
            status=HTTPStatus.CONFLICT,
            message=f"the seat '{seat}' has already been answered, or has nothing left to confirm; an answer is given once",
        )

    return None


def find_alter_refusal(*, geburtsdatum: str, today: str, mindestalter: int) -> WriteRefusal | None:
    """Why the typed date is refused, or `None`.

    Its own code with `refuse_age_outside_the_bounds`'s German rather than a `REQ-VAL-001`, whose
    mark on the field names no floor. Judged BEFORE any write, so a mistyped year spends nothing.
    """

    try:
        refuse_age_outside_the_bounds(geburtsdatum=geburtsdatum, today=today, mindestalter=mindestalter)
    except ValueError as too_young_or_too_old:
        return WriteRefusal(
            error_code=BEWERBUNG_KONTAKT_ALTER,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            fields=(("geburtsdatum",),),
            message=str(too_young_or_too_old),
        )

    return None


def _zustand(*, kontakte: Any, bestaetigungen: Any, seat: str, over: bool, gesperrt: bool) -> FLBewerbungEinwilligungZustand:
    """The one ranking both records' links are shown in: the ban first (`docs/backend/spec.md :: I515`), then a stamp."""

    if gesperrt:
        return "gesperrt"

    if _seat_is_confirmed(kontakte, seat):
        return "bestaetigt"

    if _declined_on(bestaetigungen, seat) is not None:
        return "abgelehnt"

    return "abgelaufen" if over else "gueltig"


def zustand_of(*, bewerbung_raw: Mapping[str, Any], seat: str, today: str, gesperrt: bool) -> FLBewerbungEinwilligungZustand:
    """What a reopened link shows. A confirmed seat on an accepted application reads as confirmed."""

    over = link_is_over(bestaetigungsfrist=bewerbung_raw.get("bestaetigungsfrist"), status=bewerbung_raw.get("status"), today=today)

    return _zustand(
        kontakte=bewerbung_raw.get("kontakte"), bestaetigungen=bewerbung_raw.get("bestaetigungen"), seat=seat, over=over, gesperrt=gesperrt
    )


# --- A TEAM'S SEASON ROW. A contact seat an administrator typed in is mailed its own link, resolved
# by the application's two operations: the slots and stamps are one shape, only the deadline's home
# differing.

# One hash per entry: no reminder chases these links, so nothing keeps a second one live.
SAISON_TOKEN_FIELD: Final = "token_hash"


def build_saison_token_filter(*, token_hash: str) -> Mapping[str, Any]:
    """Every seat path, so the hash alone finds the seat on whichever row holds it."""

    return {"$or": [{f"bestaetigungen.{seat}.{SAISON_TOKEN_FIELD}": token_hash} for seat in KONTAKT_ROLLEN]}


# An INCLUSION for `EINWILLIGUNG_ANSICHT_FIELDS`' reason: the rest of the row is what a base-tier read
# must not hold. The address is the ban list's alone, and the club's season name is the page's
# `schule`.
SAISON_EINWILLIGUNG_FIELDS: Mapping[str, int] = {
    **_per_seat("bestaetigungen", SAISON_TOKEN_FIELD, "abgelehnt_am", "frist"),
    **_per_seat("kontakte", "vorname", "email", "einwilligung.bestaetigt_am", "einwilligung.text_version", *KONTAKT_SEITE_FIELDS),
    "kontakte.trainer_ist_zugleich": 1,
    "saison_id": 1,
    "name": 1,
    # A team that left the season holds no seat a consent could be given for.
    "austritt": 1,
}

# The answer's read writes on the row, so it keys the patch on `_id`, and reads each seat's choices
# and their evidence as `EINWILLIGUNG_ANTWORT_FIELDS` does.
SAISON_EINWILLIGUNG_ANTWORT_FIELDS: Mapping[str, int] = {**SAISON_EINWILLIGUNG_FIELDS, **_per_seat("kontakte", *KONTAKT_WAHL_FIELDS), "_id": 1}


def saison_frist_of(*, bestaetigungen: Any, seat: str) -> Any:
    """The deadline the seat's own link carries: each seat is minted on its own day, so the row holds none."""

    entry = bestaetigungen.get(seat) if isinstance(bestaetigungen, Mapping) else None

    return entry.get("frist") if isinstance(entry, Mapping) else None


def saison_link_is_over(*, frist: Any, today: str) -> bool:
    """Whether a season row's seat link is past its own deadline: what its press refuses (`REQ-KONTAKT-004`) and the editor shows."""

    return _deadline_passed(bestaetigungsfrist=frist, today=today)


def row_takes_confirmations(*, saison_status: Any, austritt: Any) -> bool:
    """Whether a season row's seat still asks its person to confirm it: not once its season ended or its team left it.

    Such a seat grants no panel (`docs/backend/spec.md :: I375`), and a confirmation collects a birthdate for nothing.
    """

    return saison_status != "past" and austritt is None


def saison_zustand_of(*, row: Mapping[str, Any], seat: str, today: str, gesperrt: bool, saison_status: Any) -> FLBewerbungEinwilligungZustand:
    """What a reopened season-row link shows, its own deadline ending it, a closed row stopping its consent."""

    bestaetigungen = row.get("bestaetigungen")
    over = saison_link_is_over(frist=saison_frist_of(bestaetigungen=bestaetigungen, seat=seat), today=today)
    zustand = _zustand(kontakte=row.get("kontakte"), bestaetigungen=bestaetigungen, seat=seat, over=over, gesperrt=gesperrt)

    # Below the deadline, as the press refuses: past it the link takes no Widerspruch either
    # (`REQ-KONTAKT-004`), while a closed row's link still takes one (`REQ-KONTAKT-006`).
    if zustand == "gueltig" and not row_takes_confirmations(saison_status=saison_status, austritt=row.get("austritt")):
        return "saison_vorbei"

    return zustand


# The season row's own code, beside the application's 409 for its shared deadline (`REQ-BEWERBUNG-017`).
KONTAKT_LINK_ABGELAUFEN = "REQ-KONTAKT-004"


def find_saison_frist_refusal(*, frist: Any, today: str) -> WriteRefusal | None:
    """Why a season row's link takes no answer past its own deadline, or `None`.

    410, never the application's 409: no write moves this deadline, a re-send minting another token
    (`docs/backend/spec.md` §1.4).
    """

    if not saison_link_is_over(frist=frist, today=today):
        return None

    return WriteRefusal(
        error_code=KONTAKT_LINK_ABGELAUFEN,
        status=HTTPStatus.GONE,
        message="this link's confirmation deadline has passed; only a new link from the administration can confirm the seat",
    )


KONTAKT_SAISON_VORBEI = "REQ-KONTAKT-006"


def find_saison_vorbei_einwilligung_refusal(*, saison_status: Any, austritt: Any) -> WriteRefusal | None:
    """Why a season row's link takes no consent once its season has ended or its team left it, or `None`.

    410: no write reopens a past season, and a Widerspruch is still taken, the person removing
    themselves (`docs/backend/spec.md` §1.4).
    """

    if row_takes_confirmations(saison_status=saison_status, austritt=austritt):
        return None

    return WriteRefusal(
        error_code=KONTAKT_SAISON_VORBEI,
        status=HTTPStatus.GONE,
        message="this link's season has ended or its team has left it, so it confirms nothing; a Widerspruch is still taken",
    )


def saison_link_pair(*, kontakte: Any, bestaetigungen: Any, seat: str, token_hash: str) -> FLKontaktRolle | None:
    """The other seat this season-row link was minted for, still unconfirmed, or `None`.

    Never `paired_seat`: a Trainer confirmed before taking a second seat is minted a link for that seat
    alone, and answering both overwrites the earlier stamp.
    """

    other = claimed_pair_seat(kontakte=kontakte, seat=seat)
    if other is None or not seat_stands(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=other):
        return None

    entry = bestaetigungen[other]
    if entry.get(SAISON_TOKEN_FIELD) != token_hash or _seat_is_confirmed(kontakte, other):
        return None

    return other


def compose_saison_decline_update(*, seats: Sequence[str], today: str) -> Mapping[str, Any]:
    """A Widerspruch empties the person's slots and records the day on the link entry beside each, where the emptying cannot reach."""

    written: dict[str, Any] = {}
    for seat in seats:
        written[f"kontakte.{seat}"] = None
        written[f"bestaetigungen.{seat}.abgelehnt_am"] = today

    return {"$set": written}


def ausstehende_seats(*, kontakte: Any) -> list[FLKontaktRolle]:
    """Every seat without a stamp, in declaration order. An emptied slot counts: the application cannot complete without it."""

    return [seat_named(seat) or cast(FLKontaktRolle, seat) for seat in KONTAKT_ROLLEN if not _seat_is_confirmed(kontakte, seat)]


def find_unconfirmed_kontakte_refusal(*, kontakte: Any, bestaetigungen: Any) -> WriteRefusal | None:
    """Why this application is not yet one the league may accept, or `None`.

    An application with NO `bestaetigungen` block passes: every one stored before the flow shipped
    would otherwise become unacceptable in the same deploy.
    """

    if not isinstance(bestaetigungen, Mapping):
        return None

    outstanding = ausstehende_seats(kontakte=kontakte)
    if outstanding:
        return WriteRefusal(
            error_code=BEWERBUNG_KONTAKTE_UNCONFIRMED,
            status=HTTPStatus.CONFLICT,
            message=f"acceptance waits for every contact person to confirm their own seat; still outstanding: {', '.join(outstanding)}",
        )

    return None


def seat_stands(*, kontakte: Any, bestaetigungen: Any, seat: str) -> bool:
    """Whether both halves of a seat are there for a dotted `$set` to reach: the slot, and the bookkeeping entry beside it."""

    slot = kontakte.get(seat) if isinstance(kontakte, Mapping) else None
    entry = bestaetigungen.get(seat) if isinstance(bestaetigungen, Mapping) else None

    return isinstance(slot, Mapping) and isinstance(entry, Mapping)


def paired_seat(*, kontakte: Any, bestaetigungen: Any, seat: str) -> FLKontaktRolle | None:
    """The other seat the same person still holds, or `None`: one click answers for the person, not for one of their two seats."""

    zugleich = kontakte.get("trainer_ist_zugleich") if isinstance(kontakte, Mapping) else None
    if zugleich is None:
        return None

    other = seat_named(zugleich) if seat == "trainer" else (cast(FLKontaktRolle, "trainer") if seat == zugleich else None)

    # An emptied seat is nobody's: a dotted `$set` under its null slot or its null entry is
    # `PathNotViable`, and the abort takes the answer for the seat that IS this person's with it.
    return other if other is not None and seat_stands(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=other) else None


def seat_adressen(*, kontakte: Any, seats: Iterable[str]) -> set[str]:
    """The stored address of each of these seats that still holds one.

    One helper for the consent and the view, so the page shows the ban for exactly the addresses a
    press would be refused on (`docs/backend/spec.md :: I515`).
    """

    slots = [kontakte.get(seat) for seat in seats] if isinstance(kontakte, Mapping) else []

    return {str(slot["email"]) for slot in slots if isinstance(slot, Mapping) and slot.get("email")}


def seat_vorname(*, kontakte: Any, seat: str) -> str:
    """The first name in a seat's slot, or `""` where the slot is empty."""

    slot = kontakte.get(seat) if isinstance(kontakte, Mapping) else None

    return str(slot.get("vorname") or "") if isinstance(slot, Mapping) else ""


def ansprechperson_mailbox(*, kontakte: Any) -> tuple[str | None, list[FLKontaktRolle]]:
    """The Ansprechperson's address as stored, and every seat that same inbox holds.

    `None` where that seat is empty: the message this addresses has nowhere to go, and a substitute
    recipient would mail a third party.
    """

    slots = kontakte if isinstance(kontakte, Mapping) else {}
    addresses: dict[str, str] = {}

    for seat in KONTAKT_ROLLEN:
        slot = slots.get(seat)
        email = str(slot.get("email") or "").strip() if isinstance(slot, Mapping) else ""
        if email:
            addresses[seat] = email

    anchor = addresses.get("ansprechperson")
    if anchor is None:
        return None, []

    key = mailbox_key(anchor)
    held = [seat for seat in KONTAKT_ROLLEN if seat in addresses and mailbox_key(addresses[seat]) == key]

    return anchor, [seat_named(seat) or cast(FLKontaktRolle, seat) for seat in held]


def compose_confirmation_update(
    *,
    kontakte: Mapping[str, Any],
    seats: Sequence[str],
    geburtsdatum: str,
    today: str,
    text_version: str,
    whatsapp: bool,
    medien: bool,
    am: str,
) -> Mapping[str, Any]:
    """The ONE update a confirmation is, on every seat the person holds.

    `docs/backend/spec.md :: I141` rests on the date and the stamp landing together, which is why
    this is one update and never two.
    """

    written: dict[str, Any] = {}
    for seat in seats:
        pfad = f"kontakte.{seat}.einwilligung"
        written[f"kontakte.{seat}.geburtsdatum"] = geburtsdatum
        # Field by field, never the block whole: `eingetragen_von` and `datum` are the seating's, and
        # what it tells stands after the answer.
        written[f"{pfad}.bestaetigt_am"] = today
        written[f"{pfad}.text_version"] = text_version
        written.update(
            compose_wahlen(
                pfad=pfad,
                gespeichert=kontakte[seat]["einwilligung"],
                gesetzt={"umfang": KONTAKT_UMFANG_WHATSAPP if whatsapp else KONTAKT_UMFANG, "medien": medien},
                am=am,
                text_version=text_version,
                stamp=log_stamp,
            )
        )

    # A speaker a seat stored before its answer names is no truer once its person has answered.
    return {"$set": written, "$unset": {f"kontakte.{seat}.einwilligung.{field}": "" for seat in seats for field in SPRECHER}}


# The two pages' own fills: the account page states a seat's words with these too, so each confirmation
# page and the account page fill `{schule}` alike.
def saison_schule(row: Mapping[str, Any]) -> str:
    """What the season row's confirmation page fills `{schule}` with: the name the club carries that season."""

    return str(row.get("name") or "")


def bewerbung_schule(*, bewerbung_raw: Mapping[str, Any], club_name: Any) -> str:
    """What the application's confirmation page fills `{schule}` with: the school as submitted, or the picked club's own name."""

    schule = bewerbung_raw.get("schule")
    if isinstance(schule, Mapping):
        return str(schule.get("team_name") or "")

    return str(club_name or "")


def build_eigene_bewerbung_filter(identifier: str) -> Mapping[str, Any]:
    """Every PENDING application whose seats may name the address, a pre-filter the fold decides on.

    Pending alone: an accepted application's seats are its season row's, and a declined one's go with it.
    """

    return {"status": "eingereicht", **rows_possibly_naming(identifier)}


# The pages a contact seat's link opens, named as the registry names them: the applicant's, and one
# for a person the administration seated on each home.
KontaktSeite = Literal["bestaetigung_kontakt", "bestaetigung_kontakt_verwaltung", "bestaetigung_kontakt_saison"]


def kontakt_seite_of(*, einwilligung: Any, sonst_vom_bewerber: bool, verwaltet: KontaktSeite) -> KontaktSeite:
    """The page this seat's link opens: the applicant's where the applicant named the person, else its home's own.

    Read off `eingetragen_von`, which nothing after the seating moves; a record stored before it takes
    the caller's reading of its home.
    """

    eingetragen_von = einwilligung.get("eingetragen_von") if isinstance(einwilligung, Mapping) else None
    vom_bewerber = eingetragen_von == "bewerbung" if eingetragen_von in get_args(FLKontaktEingetragenVon) else sonst_vom_bewerber

    return "bestaetigung_kontakt" if vom_bewerber else verwaltet


def _einwilligung_of(kontakte: Any, seat: str) -> Mapping[str, Any]:
    slot = kontakte.get(seat) if isinstance(kontakte, Mapping) else None
    einwilligung = slot.get("einwilligung") if isinstance(slot, Mapping) else None

    return einwilligung if isinstance(einwilligung, Mapping) else {}


def bewerbung_kontakt_seite(*, bewerbung_raw: Mapping[str, Any], seat: str) -> KontaktSeite:
    einwilligung = _einwilligung_of(bewerbung_raw.get("kontakte"), seat)

    # Before `eingetragen_von`: the submission stamps its own day on every seat it writes, and a reseat the
    # day it seats somebody, so a seat dated otherwise was filled by an administrator.
    vom_bewerber = einwilligung.get("datum") == bewerbung_raw.get("eingereicht_am")

    return kontakt_seite_of(einwilligung=einwilligung, sonst_vom_bewerber=vom_bewerber, verwaltet="bestaetigung_kontakt_verwaltung")


def antwort_seite(*, seiten: Sequence[KontaktSeite], verwaltet: KontaktSeite) -> KontaktSeite:
    """The one page a link answering seats of these pages opens, which its answer is judged against (`docs/backend/spec.md :: I861`).

    The applicant's only where every seat's is: one press is one person's answer to one page.
    """

    return "bestaetigung_kontakt" if seiten and all(seite == "bestaetigung_kontakt" for seite in seiten) else verwaltet


def bewerbung_antwort_seite(*, bewerbung_raw: Mapping[str, Any], seats: Sequence[str]) -> KontaktSeite:
    return antwort_seite(
        seiten=[bewerbung_kontakt_seite(bewerbung_raw=bewerbung_raw, seat=seat) for seat in seats], verwaltet="bestaetigung_kontakt_verwaltung"
    )


def saison_kontakt_seite(*, row: Mapping[str, Any], seat: str) -> KontaktSeite:
    """The page a season row's seat opens.

    A seat stored before `eingetragen_von` opens the season row's own page, whoever named its person:
    the applicant's page promises a deletion and a message that a season row's link never brings.
    """

    return kontakt_seite_of(
        einwilligung=_einwilligung_of(row.get("kontakte"), seat),
        sonst_vom_bewerber=False,
        verwaltet="bestaetigung_kontakt_saison",
    )


def saison_antwort_seite(*, row: Mapping[str, Any], seats: Sequence[str]) -> KontaktSeite:
    """The page a season row's link opens for the seats its answer writes: the view's and the press's one source."""

    return antwort_seite(seiten=[saison_kontakt_seite(row=row, seat=seat) for seat in seats], verwaltet="bestaetigung_kontakt_saison")


def compose_decline_update(*, seats: Sequence[str], today: str) -> Mapping[str, Any]:
    """A decline empties the person's slot and records the day beside it, where the emptying cannot reach."""

    written: dict[str, Any] = {}
    for seat in seats:
        written[f"kontakte.{seat}"] = None
        written[f"bestaetigungen.{seat}.abgelehnt_am"] = today

    # The submission's digest was taken over this person's details too, and a hash of personal data is
    # still personal data. A replay then meets the refusal of other details, which stays true.
    return {"$set": written, "$unset": {"idempotenz_fingerabdruck": ""}}


def compose_erneut_update(*, seats: Sequence[str], token_hash: str, today: str, bestaetigungsfrist: str) -> Mapping[str, Any]:
    """A re-send: one fresh entry per seat this person holds, and the deadline restarts.

    Both seats one person holds, as the confirmation writes both: one entry left standing would keep
    the replaced address's link alive through `paired_seat`.
    """

    # The WHOLE entry, so the delivery state of the message the old link went out in goes with it: a
    # refusal recorded against a replaced address would hold the fresh link's application for ever.
    written: dict[str, Any] = {f"bestaetigungen.{seat}": compose_bestaetigung(token_hash=token_hash, today=today) for seat in seats}

    return {"$set": {**written, "bestaetigungsfrist": bestaetigungsfrist}}


def build_erneut_filter(*, bewerbung_id: Any, seats: Sequence[str]) -> Mapping[str, Any]:
    """`seat_is_answered` negated per seat, as the re-send's own filter.

    The re-send reads outside any transaction and replaces the WHOLE entry, so an answer or an
    erasure committed after its read would otherwise lose its record under a live link.
    """

    unanswered: dict[str, Any] = {}
    for seat in seats:
        unanswered[f"bestaetigungen.{seat}"] = {"$type": "object"}
        unanswered[f"bestaetigungen.{seat}.abgelehnt_am"] = None
        unanswered[f"kontakte.{seat}.einwilligung.bestaetigt_am"] = UNCONFIRMED_STAMP

    return {"_id": bewerbung_id, "status": "eingereicht", **unanswered}


def find_gesperrt_refusal(*, gesperrt: bool) -> WriteRefusal | None:
    """`REQ-BEWERBUNG-018`: the ban list holds one of the addresses a submission names.

    Takes the answer rather than the lookup, so the caller's reads run in the caller's transaction.
    """

    if not gesperrt:
        return None

    # NEUTRAL and naming no seat, as the registration's refusal is: a stranger learns nothing about a
    # list, and 403 because what fails is who is applying rather than the season's state.
    return WriteRefusal(
        error_code=BEWERBUNG_ADRESSE_GESPERRT,
        status=HTTPStatus.FORBIDDEN,
        message="one of the email addresses this application names cannot be used; use another, or ask the league",
    )


def find_kontakt_gesperrt_refusal(*, gesperrt: bool) -> WriteRefusal | None:
    """`REQ-BEWERBUNG-019`: an administrator's correction or reseat names an address the ban list holds.

    409 where the public form's is 403: an administrator's write naming it is about the entry it writes
    (`docs/backend/spec.md :: 1.4`), as the referee editor's `REQ-SCHIEDSRICHTER-007` is.
    """

    if not gesperrt:
        return None

    return WriteRefusal(
        error_code=BEWERBUNG_KONTAKT_GESPERRT,
        status=HTTPStatus.CONFLICT,
        message="this email address is on the ban list, so no confirmation link may be sent to it; lift the entry first",
    )


def find_einwilligung_gesperrt_refusal(*, gesperrt: bool) -> WriteRefusal | None:
    """`REQ-BEWERBUNG-020`: the ban list holds the address a confirmation link was mailed to, however long ago it was minted.

    Asked of a consent alone: a Widerspruch empties the seat, which is what a barred person is owed.
    """

    if not gesperrt:
        return None

    # 403 and named plainly, where the form's is neutral: whoever holds the mailed token holds that
    # mailbox, as a sign-in code's holder does, and the ban's own mail has told them.
    return WriteRefusal(
        error_code=BEWERBUNG_EINWILLIGUNG_GESPERRT,
        status=HTTPStatus.FORBIDDEN,
        message="the email address this link was sent to is on the ban list, so it confirms nothing; a Widerspruch is still taken",
    )


def find_kontakt_email_refusal(*, kontakte: Any, seats: Sequence[str], email: str) -> WriteRefusal | None:
    """Why this address cannot be the seat's, or `None`.

    The submission's own distinctness rule asked again -- two DIFFERENT people are not reachable at
    one mailbox -- because a correction is the one path that could put them there afterwards.
    """

    slots = kontakte if isinstance(kontakte, Mapping) else {}
    # The seats this correction writes are left out: they are one person, and their blocks are equal
    # by the submission's own rule.
    others = [slots.get(seat) for seat in KONTAKT_ROLLEN if seat not in seats]
    # On the sign-in fold, as `FLBewerbungKontaktePayload` compares it: a third spelling of "one
    # mailbox" here would refuse where the form accepted, or the reverse.
    held = {sign_in_identifier(str(slot.get("email") or "")) for slot in others if isinstance(slot, Mapping)}

    if sign_in_identifier(email) in held:
        return WriteRefusal(
            error_code=BEWERBUNG_KONTAKT_EMAIL_TAKEN,
            status=HTTPStatus.CONFLICT,
            message="another contact person on this application is reached at this address; two different people share no mailbox",
        )

    return None


def compose_kontakt_email_update(
    *, seats: Sequence[str], email: str, token_hash: str, today: str, bestaetigungsfrist: str
) -> Mapping[str, Any]:
    """The corrected address and a fresh link, in ONE `$set`.

    Never two writes: between them the seat would hold the new address beside the link the old one
    was mailed, which is the live credential the correction exists to retire.
    """

    erneut = compose_erneut_update(seats=seats, token_hash=token_hash, today=today, bestaetigungsfrist=bestaetigungsfrist)

    return {"$set": {**{f"kontakte.{seat}.email": email for seat in seats}, **erneut["$set"]}}


# --- The RESEAT: another person in a seat its own holder stepped out of.


def seat_awaits_a_replacement(*, bestaetigungen: Any, seat: str) -> bool:
    """Whether this seat is empty because its person exercised their Widerspruch.

    The ONE place an ERASED seat is refused: an erasure clears the whole entry, so the `abgelehnt_am`
    a decline leaves behind is all that parts the two empty slots.
    """

    return _declined_on(bestaetigungen, seat) is not None


def find_reseat_refusal(*, bestaetigungen: Any, seats: Sequence[str]) -> WriteRefusal | None:
    """Why no other person may be seated here, or `None`.

    Its own predicate beside `find_already_answered_refusal`, which refuses the declined seat this
    one exists for: widening that one would let the re-send mint against an emptied slot.
    """

    # EVERY seat, because a claimed pair is one person: a mirror in another state is refused rather
    # than written unjudged, or dropped from a write that asked for both.
    for seat in seats:
        if not seat_awaits_a_replacement(bestaetigungen=bestaetigungen, seat=seat):
            return WriteRefusal(
                error_code=BEWERBUNG_SEAT_ALREADY_ANSWERED,
                status=HTTPStatus.CONFLICT,
                message=f"the seat '{seat}' takes no other person; only a seat whose own holder stepped out of it is seated again",
            )

    return None


def claimed_pair_seat(*, kontakte: Any, seat: str) -> FLKontaktRolle | None:
    """The other seat `trainer_ist_zugleich` claims for this person, standing or emptied.

    `paired_seat` without its `seat_stands` half, which answers `None` for exactly the emptied slots
    a reseat runs on and would leave one of them holding the other's link.
    """

    zugleich = kontakte.get("trainer_ist_zugleich") if isinstance(kontakte, Mapping) else None
    if zugleich is None:
        return None

    return seat_named(zugleich) if seat == "trainer" else (cast(FLKontaktRolle, "trainer") if seat == zugleich else None)


def compose_kontakt_seat_update(
    *, seats: Sequence[str], person: Mapping[str, Any], text_version: str, token_hash: str, today: str, bestaetigungsfrist: str
) -> Mapping[str, Any]:
    """The new person and their fresh link, in ONE `$set`. Two writes would seat them behind the link the seat's last holder still holds."""

    erneut = compose_erneut_update(seats=seats, token_hash=token_hash, today=today, bestaetigungsfrist=bestaetigungsfrist)
    # Born afresh: nothing of the person who stepped out travels to the one seated.
    einwilligung = compose_einwilligung(text_version=text_version, today=today, eingetragen_von="liga")
    # Null rather than left off, as the submission writes it: the key marks a date not yet entered,
    # and the confirmation fills it (`docs/backend/spec.md :: I141`).
    slot = {**person, "geburtsdatum": None, "einwilligung": einwilligung}

    # The WHOLE slot per seat, never a dotted path under it: a decline nulled the slot, and a dotted
    # `$set` under a null is `PathNotViable`, which aborts the transaction.
    return {"$set": {**{f"kontakte.{seat}": dict(slot) for seat in seats}, **erneut["$set"]}}


# --- The ZUSTELLSTAND: what became of the last message to one seat. Written by the two system-tier
# endpoints alone, and read by the reminder clock and the fourteen-day clock below.


# `app/api/zustellung/router.py` judges every other home through these too, passing the document for
# `bestaetigungen` and the record's carrier key for `seat`.
def _entry_of(bestaetigungen: Any, seat: str) -> Mapping[str, Any] | None:
    entry = bestaetigungen.get(seat) if isinstance(bestaetigungen, Mapping) else None

    return entry if isinstance(entry, Mapping) else None


# The states a clock reads: the provider will not carry a message to that address, however it says
# so. `verzoegert` is not one -- a delayed message still arrives -- and neither is `zugestellt`.
ZUSTELLUNG_ABGEWIESEN = frozenset({"unzustellbar", "unterdrueckt", "beschwerde"})


def seat_zustellung(*, bestaetigungen: Any, seat: str) -> Mapping[str, Any] | None:
    """What is known about the last message to this seat, or `None` where nothing is."""

    entry = _entry_of(bestaetigungen, seat)
    stored = entry.get("zustellung") if entry is not None else None

    return stored if isinstance(stored, Mapping) else None


def seat_is_unreachable(*, bestaetigungen: Any, seat: str) -> bool:
    """Whether the provider refused the last message to this seat's address."""

    stored = seat_zustellung(bestaetigungen=bestaetigungen, seat=seat)

    return stored is not None and stored.get("stand") in ZUSTELLUNG_ABGEWIESEN


def zustellung_event_applies(*, bestaetigungen: Any, seat: str, nachricht_id: str, am: str) -> bool:
    """Whether this event is about the message this seat still holds, and is news.

    The whole of the idempotency, and why no `svix-id` store sits beside it: a repeat carries the
    stamp it first did.
    """

    stored = seat_zustellung(bestaetigungen=bestaetigungen, seat=seat)
    if stored is None or stored.get("nachricht_id") != nachricht_id:
        return False

    # STRICTLY later, on two stamps `app/api/bewerbungen/schemas.py :: normalise_zustellzeitpunkt`
    # spelled: equal is the same event again, and earlier is a delivery overtaking a bounce.
    return str(stored.get("am") or "") < am


def zustellung_send_applies(*, bestaetigungen: Any, seat: str, am: str) -> bool:
    """Whether this accepted send is news for a seat that still stands.

    No id comparison: the send MINTS the id, so it is the first thing known about a message and
    nothing stored can match it.
    """

    if _entry_of(bestaetigungen, seat) is None:
        return False

    stored = seat_zustellung(bestaetigungen=bestaetigungen, seat=seat)
    # A stored EVENT never blocks a send: its stamp is the provider's clock, and a host running
    # behind one would drop every re-send, freezing the seat on a message whose events the judge
    # above then discards.
    if stored is None or stored.get("stand") != "angenommen":
        return True

    # Two accepts ARE comparable, both stamps being this host's: one fan-out mints a message per
    # address of a record and settles them together
    # (`fl_frontend/src/features/zustellung/notifications.ts :: sendZielMail`).
    return str(stored.get("am") or "") < am


def compose_zustellung_update(*, seats: Sequence[str], nachricht_id: str, stand: str, grund: str | None, am: str) -> Mapping[str, Any]:
    """The whole block per seat, never a field of it: a state carrying another message's `grund` reads as a refusal that never happened."""

    written = {f"bestaetigungen.{seat}.zustellung": {"nachricht_id": nachricht_id, "stand": stand, "grund": grund, "am": am} for seat in seats}

    return {"$set": written}


# --- The retention SWEEP. Six clocks, each a pure predicate over one document and `today`, so
# every boundary is pinned without a container. Dates, never instants: an instant would move the
# boundary with the hour a pass happens to run.


def next_saison_id(saison_id: str) -> str:
    """The season after this one, ids being years.

    Raises rather than answering nothing: the accepted clock and the contact block both hang off the
    successor, so an absent one stops both for ever with nothing in any log.
    """

    # `isascii()` beside `isdigit()`, which alone is true of Arabic-Indic and fullwidth digits: `int`
    # reads those as a year and returns an ASCII successor, naming a season the original cannot be
    # matched to.
    if not (saison_id.isascii() and saison_id.isdigit() and len(saison_id) == SAISON_ID_LENGTH):
        raise ValueError(f"the retention sweep needs a season id of {SAISON_ID_LENGTH} ASCII digits, and this season's is not one")

    return f"{int(saison_id) + 1:0{SAISON_ID_LENGTH}d}"


def one_month_after(*, day: str) -> str:
    """The same day of the next month, clamped to that month's end.

    The bound is one calendar month, and thirty days is not that (`docs/backend/spec.md :: I153`).
    """

    start = date.fromisoformat(day)
    year, month = (start.year + 1, 1) if start.month == 12 else (start.year, start.month + 1)
    last_day = (date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)) - timedelta(days=1)

    return date(year, month, min(start.day, last_day.day)).isoformat()


def latest_decision_due(*, today: str) -> str:
    """The last decision day whose month is behind it today.

    Found through `one_month_after`, never a month counted back from today: that month CLAMPS to a
    short month's end and drops the due decisions of the days past it.
    """

    day = date.fromisoformat(today)
    while one_month_after(day=day.isoformat()) > today:
        day -= timedelta(days=1)

    return day.isoformat()


def seat_reminder_is_due(*, kontakte: Any, bestaetigungen: Any, seat: str, today: str) -> bool:
    """Whether this seat's one reminder is owed today: open, unanswered, never reminded, mailed three or more days ago, and reachable.

    A re-sent seat carries a later `verschickt_am` and reaches its mark on its own; one already
    reminded never is again.
    """

    entry = _entry_of(bestaetigungen, seat)
    if entry is None or _seat_is_confirmed(kontakte, seat) or entry.get("abgelehnt_am") is not None:
        return False

    if entry.get("erinnert_am") is not None or not isinstance(entry.get("verschickt_am"), str):
        return False

    # A seat gets ONE chase, and spending it on an address the provider has already refused spends
    # it on nobody; a correction is what makes the seat due again, by writing a fresh entry.
    if seat_is_unreachable(bestaetigungen=bestaetigungen, seat=seat):
        return False

    return days_after(day=entry["verschickt_am"], days=BEWERBUNG_ERINNERUNG_TAGE) <= today


def reminder_seats(*, bewerbung_raw: Mapping[str, Any], today: str) -> list[FLKontaktRolle]:
    """Every seat of this application owed a reminder today, in declaration order; none once the link is over."""

    if link_is_over(bestaetigungsfrist=bewerbung_raw.get("bestaetigungsfrist"), status=bewerbung_raw.get("status"), today=today):
        return []

    kontakte, bestaetigungen = bewerbung_raw.get("kontakte"), bewerbung_raw.get("bestaetigungen")

    return [
        seat_named(seat) or cast(FLKontaktRolle, seat)
        for seat in KONTAKT_ROLLEN
        if seat_reminder_is_due(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=seat, today=today)
    ]


def group_seats_by_mailbox(*, kontakte: Any, seats: Sequence[str]) -> list[tuple[str, list[FLKontaktRolle]]]:
    """The seats as the mails go out: one message per mailbox, in first-seen order.

    Keyed as the first mail keys it (`app/shared/folding.py :: mailbox_key`).
    """

    slots = kontakte if isinstance(kontakte, Mapping) else {}
    grouped: dict[str, tuple[str, list[FLKontaktRolle]]] = {}

    for seat in seats:
        slot = slots.get(seat)
        email = str(slot.get("email") or "").strip() if isinstance(slot, Mapping) else ""
        if not email:
            continue
        address, held = grouped.setdefault(mailbox_key(email), (email, []))
        held.append(seat_named(seat) or cast(FLKontaktRolle, seat))

    return list(grouped.values())


def reminder_link_groups(*, kontakte: Any, bestaetigungen: Any, seats: Sequence[str]) -> list[list[FLKontaktRolle]]:
    """The Trainer rides the link of the seat it mirrors (`docs/backend/spec.md :: I157`).

    `paired_seat` answers both from either press, so a second link asks one reader twice; it keeps
    its own only where that seat is not reminded here.
    """

    held: list[FLKontaktRolle] = [seat_named(seat) or cast(FLKontaktRolle, seat) for seat in seats]
    groups: dict[FLKontaktRolle, list[FLKontaktRolle]] = {}

    for seat in held:
        partner = paired_seat(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=seat)
        anchor = partner if seat == "trainer" and partner is not None and partner in held else seat
        groups.setdefault(anchor, []).append(seat)

    return list(groups.values())


def compose_erinnerung_update(*, hashes: Mapping[str, str], bestaetigungen: Any, today: str) -> Mapping[str, Any]:
    """The reminder's ONE `$set`: the stamp and the fresh hash per seat, the first hash kept beside it.

    `verschickt_am` and the deadline stay: a reminder is not a re-send (`docs/backend/spec.md :: I152`).
    """

    written: dict[str, Any] = {}
    for seat, token_hash in hashes.items():
        entry = _entry_of(bestaetigungen, seat) or {}
        written[f"bestaetigungen.{seat}.token_hash"] = token_hash
        written[f"bestaetigungen.{seat}.token_hash_zuvor"] = entry.get("token_hash")
        written[f"bestaetigungen.{seat}.erinnert_am"] = today

    return {"$set": written}


def announcement_is_undeliverable(*, bewerbung_raw: Mapping[str, Any]) -> bool:
    """Whether the deletion notice cannot reach the submitter: the provider refused the last message to that seat.

    An EMPTY Ansprechperson slot is not this case: no mailbox is left to tell, and the deadline takes
    the application unannounced.
    """

    return seat_is_unreachable(bestaetigungen=bewerbung_raw.get("bestaetigungen"), seat="ansprechperson")


def deletion_is_due(*, bewerbung_raw: Mapping[str, Any], today: str) -> bool:
    """Whether the fourteen-day clock takes this application: submitted, past its deadline, a seat outstanding, the notice deliverable.

    STRICTLY past: the link answers on the deadline's own day, so the deletion waits a day. An
    emptied seat is outstanding.
    """

    if bewerbung_raw.get("status") != "eingereicht":
        return False

    frist = bewerbung_raw.get("bestaetigungsfrist")
    if not isinstance(frist, str) or frist >= today:
        return False

    # HELD rather than erased, and held by dropping out of the clock every path here reads: an
    # administrator corrects the address, and the correction's fresh entry makes it due again.
    if announcement_is_undeliverable(bewerbung_raw=bewerbung_raw):
        return False

    return bool(ausstehende_seats(kontakte=bewerbung_raw.get("kontakte")))


def deletion_was_announced(*, bewerbung_raw: Mapping[str, Any]) -> bool:
    """Whether this application's deletion notice is behind it.

    The erasure's second condition beside the deadline: without it a run that mailed and then failed
    to erase would mail again every hour until it went through.
    """

    return isinstance(bewerbung_raw.get("loeschung_angekuendigt_am"), str)


def compose_ankuendigung_update(*, today: str) -> Mapping[str, Any]:
    """The stamp the deletion notice earns, written only where none stands: an existing one is the day that notice was settled."""

    return {"$set": {"loeschung_angekuendigt_am": today}}


# One read's ceiling, and one past it tells a full page from a truncated one
# (`docs/backend/spec.md :: I295`, which the registration sweep keeps the same way).
SWEEP_PAGE: Final = LIST_LIMIT_MAX


# The terms `seat_reminder_is_due` asks of one seat, as a query, so a reminded seat leaves the read.
def _seat_reminder_term(*, seat: str, today: str) -> Mapping[str, Any]:
    return {
        f"bestaetigungen.{seat}.verschickt_am": {"$lte": days_after(day=today, days=-BEWERBUNG_ERINNERUNG_TAGE)},
        f"bestaetigungen.{seat}.erinnert_am": None,
        f"bestaetigungen.{seat}.abgelehnt_am": None,
        f"bestaetigungen.{seat}.zustellung.stand": {"$nin": sorted(ZUSTELLUNG_ABGEWIESEN)},
        f"kontakte.{seat}.einwilligung.bestaetigt_am": UNCONFIRMED_STAMP,
    }


def build_erinnerung_filter(*, saison_id: str, today: str) -> Mapping[str, Any]:
    """Every application with a seat owed its reminder, as `reminder_seats` judges it.

    In the query: the clock stamps a share a pass, and a read keeping stamped rows hands the next
    pass the same page.
    """

    return {
        "saison_id": saison_id,
        "status": "eingereicht",
        # `$not` rather than `$gte`: a row carrying no readable deadline has a link that is not over.
        "bestaetigungsfrist": {"$not": {"$lt": today}},
        "$or": [_seat_reminder_term(seat=seat, today=today) for seat in KONTAKT_ROLLEN],
    }


def build_deletion_filter(*, saison_id: str, today: str) -> Mapping[str, Any]:
    """Every application `deletion_is_due` takes, as a query: a held one would otherwise fill the page ahead of a due one."""

    return {
        "saison_id": saison_id,
        "status": "eingereicht",
        "bestaetigungsfrist": {"$lt": today},
        "bestaetigungen.ansprechperson.zustellung.stand": {"$nin": sorted(ZUSTELLUNG_ABGEWIESEN)},
        "$or": [{f"kontakte.{seat}.einwilligung.bestaetigt_am": UNCONFIRMED_STAMP} for seat in KONTAKT_ROLLEN],
    }


def decline_erasure_is_due(*, bewerbung_raw: Mapping[str, Any], today: str) -> bool:
    """Whether the one-month clock takes this declined application, counted from the day the decision was taken."""

    if bewerbung_raw.get("status") != "abgelehnt":
        return False

    entscheidung = bewerbung_raw.get("entscheidung")
    getroffen_am = entscheidung.get("getroffen_am") if isinstance(entscheidung, Mapping) else None

    return isinstance(getroffen_am, str) and one_month_after(day=getroffen_am) <= today


def season_has_ended(*, saison_status: Any) -> bool:
    """Whether a season is over.

    Read off `saisons.status` rather than computed from a date, as the design fixes; a season not
    yet created is not past.
    """

    return saison_status == "past"


def season_after_has_ended(*, next_saison_status: Any) -> bool:
    """The accepted clock and the contact block share one test: the season after the one applied for is `past`."""

    return season_has_ended(saison_status=next_saison_status)


def acceptance_erasure_is_due(*, bewerbung_raw: Mapping[str, Any], next_saison_status: Any) -> bool:
    return bewerbung_raw.get("status") == "angenommen" and season_after_has_ended(next_saison_status=next_saison_status)


def undecided_erasure_is_due(*, bewerbung_raw: Mapping[str, Any], saison_status: Any) -> bool:
    """Whether the season's own end takes this application: undecided, and its season is over.

    Nothing else is asked: a confirmed seat, a missing deadline and a refused notice each drop an
    application out of the fourteen-day clock.
    """

    return bewerbung_raw.get("status") == "eingereicht" and season_has_ended(saison_status=saison_status)


def schule_name(*, bewerbung_raw: Mapping[str, Any], club_names: Mapping[Any, str]) -> str:
    """The school's name as submitted, or the picked club's as the router resolved it; empty where neither resolves."""

    schule = bewerbung_raw.get("schule")
    if isinstance(schule, Mapping):
        return str(schule.get("team_name") or "")

    return club_names.get(bewerbung_raw.get("team_id"), "")


def vorname_of(*, kontakte: Any, seat: str) -> str | None:
    slot = kontakte.get(seat) if isinstance(kontakte, Mapping) else None

    return str(slot.get("vorname") or "") or None if isinstance(slot, Mapping) else None


def assigned_trikot_farben(*, stored: Sequence[Any]) -> list[FLTrikotFarbe]:
    """The season's assigned colours, in the palette's own order.

    The RETURN filters through the palette rather than sorting `held` by it: a row assigned nothing
    yields a null, and one predating the enum a value the model cannot serve.
    """

    # `set(stored)` is the shorthand this refuses: an unhashable BSON value would raise there, where
    # this drops it. `app/core/constraints.py :: saison_teams.trikot_farbe` forbids one, so this holds
    # the boundary rather than a case any test can reach.
    held = {value for value in stored if isinstance(value, str)}

    # The form excludes what this returns, and a season may field at least as many teams as the palette
    # has colours. `fl_frontend/src/features/teams/utils.ts :: offeredTrikotFarben` then hands the whole
    # palette back once every colour is assigned.
    return [farbe for farbe in get_args(FLTrikotFarbe) if farbe in held]


def build_bewerbungen_saisonbezug_terms(*, saison_id: str | None) -> dict[FLBewerbungSaisonbezug, dict[str, Any]]:
    """Each relation's own term, for the count its option is told.

    A request naming no season is answered against `None`, which no application carries, so every row
    falls under `andere_saison` -- where
    `fl_frontend/src/features/bewerbungen/utils.ts :: buildBewerbungRows` files those same rows.
    """

    return {"diese_saison": {"saison_id": saison_id}, "andere_saison": {"saison_id": {"$ne": saison_id}}}


def build_bewerbungen_saison_term(*, saison_id: str | None, saisonbezug: Sequence[str] | None) -> dict[str, Any]:
    """Which seasons the read covers, as the bar's relation to the season the caller named.

    A relation rather than the id alone, the bar offering a complement no `saison_id` can express.
    """

    if saison_id is None:
        return {}

    # The parameter's older meaning, kept: a caller naming no relation asked for that season's queue.
    if saisonbezug is None:
        return {"saison_id": saison_id}

    picked = [relation for relation in get_args(FLBewerbungSaisonbezug) if relation in saisonbezug]

    # Every relation picked is every season, and so the facet turned off.
    if len(picked) != 1:
        return {}

    return build_bewerbungen_saisonbezug_terms(saison_id=saison_id)[picked[0]]


def build_bewerbungen_status_term(status: Sequence[str] | None) -> dict[str, Any]:
    """`$in` rather than an equality, so a facet that offers all three has a request expressing any two of them.

    The leading key of `app/core/constraints.py :: SUPPORT_INDEXES`' `bewerbungen_status_queue`
    serves it either way.
    """

    return {} if status is None else {"status": {"$in": list(status)}}


def build_bewerbungen_sort(*, sort_by: str, order: str) -> list[tuple[str, int]]:
    """The triage queue's order, tie-broken by `_id`.

    Named rather than inline so the index test can assert on what the endpoint actually sends
    (`fl_backend/tests/core/test_constraints_execution.py`).
    """

    # `_id` breaks the tie in `order`'s OWN direction, so same-day rows read the way the queue does
    # and the pair is the index's key or its exact inverse. Pinned descending, `order=asc` would
    # match neither and scan the whole archive.
    direction = 1 if order == "asc" else -1

    return build_sort(sort_by=sort_by, order=order, chain=(("_id", direction),))


# One `$group` over the raw fields a collision is decided on, and never a `$match` on the count
# beside it: two groups parted by a Kürzel's case are one collision, which only
# `dubletten_schluessel_of`'s fold can see.
DUBLETTEN_TALLY: Final[Sequence[Mapping[str, Any]]] = (
    {
        "$group": {
            "_id": {"saison_id": "$saison_id", "team_id": "$team_id", "shorthand": "$schule.shorthand"},
            "anzahl": {"$sum": 1},
        }
    },
)


def build_dubletten_pipeline(beyond_status: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """Every open application the request's other terms leave, grouped and never bounded.

    Named rather than inline so both test tiers assert on what the endpoint actually sends
    (`fl_backend/tests/api/test_bewerbungen_read.py :: TestTheCollisionSurvivesTheReadsCap`).
    """

    # `eingereicht` whatever status the page was narrowed to, and no `$limit`: the collision is a fact
    # about the queue, and a pass stopping where the page stops leaves a split pair unseen at both ends.
    return [{"$match": {**beyond_status, "status": "eingereicht"}}, *DUBLETTEN_TALLY]


def _dublette_schluessel(gruppe: Mapping[str, Any]) -> str | None:
    """One application's collision key, `None` where it names neither a club nor a Kürzel.

    Composed the way `fl_frontend/src/features/bewerbungen/duplicates.ts :: dublettenSchluessel`
    composes a served row's, which is the comparison that marks the row.
    """

    team_id = gruppe.get("team_id")

    if team_id is not None:
        return f"{gruppe.get('saison_id')} team {team_id}"

    kuerzel = str(gruppe.get("shorthand") or "").strip().upper()

    return None if kuerzel == "" else f"{gruppe.get('saison_id')} kuerzel {kuerzel}"


def dubletten_schluessel_of(cells: Sequence[Mapping[str, Any]]) -> list[str]:
    """Which keys more than one open application holds, over every row the tally covered.

    `.strip().upper()` and never a collation: this has to fold as the served row's key does in
    `fl_frontend/src/features/bewerbungen/duplicates.ts`, or a marked pair loses one half.
    """

    gehalten: dict[str, int] = {}

    for cell in cells:
        schluessel = _dublette_schluessel(cell["_id"])

        if schluessel is None:
            continue

        gehalten[schluessel] = gehalten.get(schluessel, 0) + cell["anzahl"]

    # Sorted, so an unchanged queue answers the same list twice.
    return sorted(schluessel for schluessel, anzahl in gehalten.items() if anzahl > 1)


def entscheider_adressen(rows: Iterable[Mapping[str, Any]]) -> list[str]:
    """Every administrator these stored applications name as their decider, folded as the ban list is asked."""

    return [
        sign_in_identifier(FLBewerbungEntscheidung.model_validate(row["entscheidung"]).von)
        for row in rows
        if row.get("entscheidung") is not None
    ]


def mit_vorenthaltener_entscheidung(row: Mapping[str, Any], gesperrt: Collection[str]) -> dict[str, Any]:
    """A stored application with its decision as every read serves it (`docs/backend/spec.md :: I452`)."""

    if row.get("entscheidung") is None:
        return dict(row)

    # As stored first, so a decision the stored shape refuses fails rather than being served withheld.
    entscheidung = FLBewerbungEntscheidung.model_validate(row["entscheidung"])
    von = withheld_actor(entscheidung.von, gesperrt)

    return {**row, "entscheidung": {**entscheidung.model_dump(), "von": von, "von_gesperrt": von is None}}
